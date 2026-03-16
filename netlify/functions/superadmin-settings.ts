import type { Context } from '@netlify/functions';
import { requireSuperadmin } from './_lib/auth.js';
import { getPlatformSettings, setPlatformSettings } from './_lib/platform-settings.js';
import { getClientIp, jsonResponse, errorResponse, parseJsonBody } from './_lib/helpers.js';
import { logAudit } from './_lib/audit.js';

interface UpdateSettingsBody {
  invite_only_registration?: boolean;
  licensing_enabled?: boolean;
  default_free_enabled?: boolean;
  default_free_seat_limit?: number;
  assistant_enabled?: boolean;
}

export default async function handler(request: Request, _context: Context) {
  try {
    if (request.method === 'GET') {
      await requireSuperadmin(request);
      const settings = await getPlatformSettings();
      return jsonResponse(settings);
    }

    if (request.method === 'POST') {
      const auth = await requireSuperadmin(request);
      const body = await parseJsonBody<UpdateSettingsBody>(request);
      const hasInviteFlag = typeof body.invite_only_registration === 'boolean';
      const hasLicensingEnabled = typeof body.licensing_enabled === 'boolean';
      const hasDefaultFreeEnabled = typeof body.default_free_enabled === 'boolean';
      const hasDefaultFreeSeatLimit = body.default_free_seat_limit !== undefined;
      const hasAssistantEnabled = typeof body.assistant_enabled === 'boolean';

      if (!hasInviteFlag && !hasLicensingEnabled && !hasDefaultFreeEnabled && !hasDefaultFreeSeatLimit && !hasAssistantEnabled) {
        return errorResponse('At least one setting is required');
      }

      if (hasDefaultFreeSeatLimit) {
        if (!Number.isInteger(body.default_free_seat_limit)) {
          return errorResponse('default_free_seat_limit must be an integer');
        }
        if ((body.default_free_seat_limit ?? 0) < 0 || (body.default_free_seat_limit ?? 0) > 1_000_000) {
          return errorResponse('default_free_seat_limit must be between 0 and 1000000');
        }
      }

      await setPlatformSettings(
        {
          invite_only_registration: hasInviteFlag ? body.invite_only_registration : undefined,
          licensing_enabled: hasLicensingEnabled ? body.licensing_enabled : undefined,
          default_free_enabled: hasDefaultFreeEnabled ? body.default_free_enabled : undefined,
          default_free_seat_limit: hasDefaultFreeSeatLimit ? body.default_free_seat_limit : undefined,
          assistant_enabled: hasAssistantEnabled ? body.assistant_enabled : undefined,
        },
        auth.user.id
      );

      const updatedSettings = await getPlatformSettings();
      await logAudit({
        user_id: auth.user.id,
        action: 'superadmin.platform_settings.updated',
        resource_type: 'platform_settings',
        resource_id: 'singleton',
        details: {
          invite_only_registration: updatedSettings.invite_only_registration,
          licensing_enabled: updatedSettings.licensing_enabled,
          default_free_enabled: updatedSettings.default_free_enabled,
          default_free_seat_limit: updatedSettings.default_free_seat_limit,
          assistant_enabled: updatedSettings.assistant_enabled,
        },
        ip_address: getClientIp(request),
      });

      return jsonResponse({
        message: 'Platform settings updated',
        ...updatedSettings,
      });
    }

    return errorResponse('Method not allowed', 405);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('Superadmin settings error:', err);
    return errorResponse('Internal server error', 500);
  }
}
