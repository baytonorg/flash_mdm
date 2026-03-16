#!/usr/bin/env node
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import pg from 'pg';

function parseArgs(argv) {
  const out = {
    apiKey: process.env.FLASH_API_KEY ?? '',
    baseUrl: process.env.FLASH_BASE_URL ?? 'https://flash-mdm.netlify.app',
    iterations: Number(process.env.HAMMER_ITERATIONS ?? 3),
    convergeMs: Number(process.env.HAMMER_CONVERGE_MS ?? 20000),
    pollMs: Number(process.env.HAMMER_POLL_MS ?? 2000),
    nestedDepth: Number(process.env.HAMMER_NESTED_DEPTH ?? 0),
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--api-key' && next) {
      out.apiKey = next;
      i += 1;
    } else if (arg === '--base-url' && next) {
      out.baseUrl = next;
      i += 1;
    } else if (arg === '--iterations' && next) {
      out.iterations = Number(next);
      i += 1;
    } else if (arg === '--converge-ms' && next) {
      out.convergeMs = Number(next);
      i += 1;
    } else if (arg === '--poll-ms' && next) {
      out.pollMs = Number(next);
      i += 1;
    } else if (arg === '--nested-depth' && next) {
      out.nestedDepth = Number(next);
      i += 1;
    }
  }
  if (!out.apiKey) throw new Error('Missing API key. Pass --api-key or set FLASH_API_KEY.');
  if (!Number.isFinite(out.iterations) || out.iterations < 1) throw new Error('iterations must be >= 1');
  if (!Number.isFinite(out.convergeMs) || out.convergeMs < 0) throw new Error('convergeMs must be >= 0');
  if (!Number.isFinite(out.pollMs) || out.pollMs < 100) throw new Error('pollMs must be >= 100');
  if (!Number.isFinite(out.nestedDepth) || out.nestedDepth < 0) throw new Error('nestedDepth must be >= 0');
  return out;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function json(value) {
  return JSON.stringify(value);
}

async function api(baseUrl, apiKey, path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} failed (${res.status}): ${json(data)}`);
  }
  return data;
}

function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}

function logStep(label, details) {
  console.log(`\n[${label}]`);
  if (details !== undefined) console.log(typeof details === 'string' ? details : json(details));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readDnsSettings(derivative) {
  return derivative?.config?.deviceConnectivityManagement?.privateDnsSettings
    ?? derivative?.config?.privateDnsSettings
    ?? null;
}

function listApplications(derivative) {
  return Array.isArray(derivative?.config?.applications) ? derivative.config.applications : [];
}

function listOncNetworks(derivative) {
  const configs = derivative?.config?.openNetworkConfiguration?.NetworkConfigurations;
  return Array.isArray(configs) ? configs : [];
}

async function getDevicePolicyState(client, deviceId) {
  const res = await client.query(
    `SELECT last_policy_sync_name,
            snapshot->>'appliedPolicyName' AS applied
     FROM devices
     WHERE id = $1`,
    [deviceId]
  );
  return res.rows[0] ?? {};
}

async function getTargetDerivatives(client, policyId, groupId, deviceId) {
  const derivDb = await client.query(
    `SELECT scope_type, scope_id, amapi_name, config, payload_hash, metadata, updated_at
     FROM policy_derivatives
     WHERE policy_id = $1
       AND (
         (scope_type = 'group' AND scope_id = $2)
         OR
         (scope_type = 'device' AND scope_id = $3)
       )`,
    [policyId, groupId, deviceId]
  );
  const derivs = derivDb.rows;
  return {
    all: derivs,
    group: derivs.find((d) => d.scope_type === 'group' && d.scope_id === groupId) ?? null,
    device: derivs.find((d) => d.scope_type === 'device' && d.scope_id === deviceId) ?? null,
  };
}

async function getDerivativeForScope(client, policyId, scopeType, scopeId) {
  const res = await client.query(
    `SELECT scope_type, scope_id, amapi_name, config, payload_hash, metadata, updated_at
     FROM policy_derivatives
     WHERE policy_id = $1 AND scope_type = $2 AND scope_id = $3
     ORDER BY updated_at DESC
     LIMIT 1`,
    [policyId, scopeType, scopeId]
  );
  return res.rows[0] ?? null;
}

async function getLegacyAppDeploymentId(client, environmentId, packageName, scopeType, scopeId) {
  const res = await client.query(
    `SELECT id
     FROM app_deployments
     WHERE environment_id = $1 AND package_name = $2 AND scope_type = $3 AND scope_id = $4
     ORDER BY updated_at DESC
     LIMIT 1`,
    [environmentId, packageName, scopeType, scopeId]
  );
  return res.rows[0]?.id ?? null;
}

async function getPolicyAssignmentLocks(client, scopeType, scopeId) {
  const res = await client.query(
    `SELECT locked, locked_sections, policy_id
     FROM policy_assignments
     WHERE scope_type = $1 AND scope_id = $2`,
    [scopeType, scopeId]
  );
  return res.rows[0] ?? null;
}

async function getPolicyAssignment(client, scopeType, scopeId) {
  const res = await client.query(
    `SELECT locked, locked_sections, policy_id
     FROM policy_assignments
     WHERE scope_type = $1 AND scope_id = $2`,
    [scopeType, scopeId]
  );
  return res.rows[0] ?? null;
}

async function getDeviceGroupId(client, deviceId) {
  const res = await client.query(`SELECT group_id FROM devices WHERE id = $1`, [deviceId]);
  return res.rows[0]?.group_id ?? null;
}

async function waitForAppliedPolicyConvergence(client, deviceId, expectedName, timeoutMs, pollMs) {
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  let lastState = await getDevicePolicyState(client, deviceId);
  let polls = 0;
  while (Date.now() < deadline) {
    if (!expectedName || lastState.applied === expectedName) {
      return {
        state: lastState,
        converged: true,
        elapsedMs: Date.now() - startedAt,
        polls,
      };
    }
    await sleep(pollMs);
    polls += 1;
    lastState = await getDevicePolicyState(client, deviceId);
  }
  return {
    state: lastState,
    converged: !expectedName || lastState.applied === expectedName,
    elapsedMs: Date.now() - startedAt,
    polls,
  };
}

async function main() {
  const { apiKey, baseUrl, iterations, convergeMs, pollMs, nestedDepth } = parseArgs(process.argv);
  const dbUrl = execSync('netlify env:get NETLIFY_DATABASE_URL', { encoding: 'utf8' }).trim();
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  const failures = [];
  let tempPolicyId = null;
  let originalGroupPolicyId = null;
  let originalDeviceAssignment = null;
  let target = null;
  let nestedRootGroupId = null;
  let nestedGroupIds = [];
  let originalDeviceGroupId = null;

  try {
    const tokenHash = hashToken(apiKey);
    const keyRes = await client.query(
      `SELECT workspace_id, environment_id, role
       FROM api_keys
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash]
    );
    if (!keyRes.rows[0]?.environment_id) throw new Error('API key not found or not environment-scoped');
    const environmentId = keyRes.rows[0].environment_id;

    const envRes = await client.query(
      `SELECT id, name FROM environments WHERE id = $1`,
      [environmentId]
    );
    const env = envRes.rows[0];
    if (!env) throw new Error('Environment not found');

    const deviceRes = await client.query(
      `SELECT id, name, group_id, amapi_name
       FROM devices
       WHERE environment_id = $1
         AND deleted_at IS NULL
         AND state = 'ACTIVE'
         AND amapi_name IS NOT NULL
         AND group_id IS NOT NULL
       ORDER BY CASE WHEN name ILIKE 'Pixel%' THEN 0 ELSE 1 END, updated_at DESC
       LIMIT 1`,
      [environmentId]
    );
    const device = deviceRes.rows[0];
    if (!device?.group_id) throw new Error('No active grouped device found in environment');

    const groupRes = await client.query(`SELECT id, name FROM groups WHERE id = $1`, [device.group_id]);
    const group = groupRes.rows[0];
    if (!group) throw new Error('Target group not found');

    const currentAssign = await getPolicyAssignment(client, 'group', group.id);
    originalGroupPolicyId = currentAssign?.policy_id ?? null;
    originalDeviceAssignment = await getPolicyAssignment(client, 'device', device.id);
    originalDeviceGroupId = device.group_id;
    target = { environment: env, device, group };
    logStep('Target', target);

    if (originalDeviceAssignment?.policy_id) {
      const unassign = await api(baseUrl, apiKey, '/api/policies/unassign', {
        method: 'POST',
        body: json({
          scope_type: 'device',
          scope_id: device.id,
        }),
      });
      logStep('ClearedDeviceAssignment', {
        device_id: device.id,
        previous_policy_id: originalDeviceAssignment.policy_id,
        previous_locked: !!originalDeviceAssignment.locked,
        previous_locked_sections: Array.isArray(originalDeviceAssignment.locked_sections)
          ? originalDeviceAssignment.locked_sections
          : [],
        unassign: unassign.amapi_sync ?? unassign,
      });
    }

    const policyName = `hammer-${Date.now()}`;
    const baseConfig = {
      privateDnsSettings: {
        privateDnsMode: 'PRIVATE_DNS_SPECIFIED_HOST',
        privateDnsHost: `hammer-0.doh.safedns.com`,
      },
    };

    const created = await api(baseUrl, apiKey, '/api/policies/create', {
      method: 'POST',
      body: json({
        environment_id: environmentId,
        name: policyName,
        deployment_scenario: 'fm',
        config: baseConfig,
      }),
    });
    tempPolicyId = created.policy?.id;
    if (!tempPolicyId) throw new Error(`Failed to create policy: ${json(created)}`);
    logStep('PolicyCreated', created);

    await api(baseUrl, apiKey, '/api/policies/assign', {
      method: 'POST',
      body: json({
        policy_id: tempPolicyId,
        scope_type: 'group',
        scope_id: group.id,
      }),
    });
    logStep('AssignedToGroup', { policy_id: tempPolicyId, group_id: group.id });

    for (let i = 1; i <= iterations; i += 1) {
      const cfg = deepClone(baseConfig);
      cfg.privateDnsSettings.privateDnsHost = `hammer-${i}.doh.safedns.com`;
      cfg.statusReportingSettings = { commonCriteriaModeEnabled: i % 2 === 0 };

      const upd = await api(baseUrl, apiKey, '/api/policies/update', {
        method: 'PUT',
        body: json({
          id: tempPolicyId,
          config: cfg,
          push_to_amapi: true,
        }),
      });

      const assign = await api(baseUrl, apiKey, '/api/policies/assign', {
        method: 'POST',
        body: json({
          policy_id: tempPolicyId,
          scope_type: 'group',
          scope_id: group.id,
        }),
      });

      const refreshed = await api(baseUrl, apiKey, `/api/devices/${device.id}`, { method: 'POST' });

      let { group: groupDeriv, device: deviceDeriv } = await getTargetDerivatives(client, tempPolicyId, group.id, device.id);

      let state = await getDevicePolicyState(client, device.id);
      let convergence = { converged: null, elapsedMs: 0, polls: 0 };
      if (state.last_policy_sync_name) {
        const waited = await waitForAppliedPolicyConvergence(
          client,
          device.id,
          state.last_policy_sync_name,
          convergeMs,
          pollMs
        );
        state = waited.state;
        convergence = { converged: waited.converged, elapsedMs: waited.elapsedMs, polls: waited.polls };
      }

      const groupDns = readDnsSettings(groupDeriv);
      const deviceDns = readDnsSettings(deviceDeriv);
      const selectedName = state.last_policy_sync_name ?? null;
      const appliedName = state.applied ?? null;
      const expectedHost = cfg.privateDnsSettings.privateDnsHost;

      const chosenDeriv = [deviceDeriv, groupDeriv].find((d) => d?.amapi_name === selectedName) ?? null;
      const chosenDns = readDnsSettings(chosenDeriv);

      const iterationReport = {
        iteration: i,
        update: upd.message ?? upd,
        assign: assign.amapi_sync ?? assign,
        refresh: refreshed.message ?? refreshed,
        selected: selectedName,
        applied: appliedName,
        converged: selectedName ? selectedName === appliedName : null,
        convergence_wait_ms: convergence.elapsedMs,
        convergence_polls: convergence.polls,
        group_derivative: groupDeriv?.amapi_name ?? null,
        device_derivative: deviceDeriv?.amapi_name ?? null,
        group_dns: groupDns,
        device_dns: deviceDns,
      };
      logStep(`Iteration ${i}`, iterationReport);

      if (!groupDeriv) failures.push({ iteration: i, type: 'missing_group_derivative' });
      if (!groupDns?.privateDnsHost || groupDns.privateDnsHost !== expectedHost) {
        failures.push({ iteration: i, type: 'group_dns_mismatch', expectedHost, actual: groupDns });
      }
      if (!selectedName) failures.push({ iteration: i, type: 'missing_last_policy_sync_name' });
      if (!appliedName) failures.push({ iteration: i, type: 'missing_applied_policy_name' });
      if (!chosenDeriv) {
        failures.push({ iteration: i, type: 'selected_derivative_not_found', selectedName });
      } else if (!chosenDns?.privateDnsHost || chosenDns.privateDnsHost !== expectedHost) {
        failures.push({
          iteration: i,
          type: 'selected_dns_mismatch',
          expectedHost,
          selectedScope: chosenDeriv.scope_type,
          actual: chosenDns,
        });
      }

      // Trigger 1: app assignment change (device scope) -> derivative should include/remove temp app
      const tempPackage = 'com.flashmdm.hammer.trigger';
      const appInstallType = i % 2 === 0 ? 'BLOCKED' : 'AVAILABLE';
      const appDeploy = await api(baseUrl, apiKey, '/api/apps/deploy', {
        method: 'POST',
        body: json({
          environment_id: environmentId,
          package_name: tempPackage,
          display_name: 'Hammer Trigger App',
          install_type: appInstallType,
          scope_type: 'device',
          scope_id: device.id,
        }),
      });
      ({ group: groupDeriv, device: deviceDeriv } = await getTargetDerivatives(client, tempPolicyId, group.id, device.id));
      const appEntries = listApplications(deviceDeriv);
      const tempAppEntry = appEntries.find((a) => a && a.packageName === tempPackage) ?? null;
      logStep(`Iteration ${i} AppTrigger`, {
        deploy: appDeploy.amapi_sync ?? appDeploy,
        package: tempPackage,
        install_type: appInstallType,
        present_in_device_derivative: !!tempAppEntry,
      });
      if (!tempAppEntry) {
        failures.push({ iteration: i, type: 'app_trigger_missing_in_derivative', package: tempPackage });
      }
      const tempAppDeploymentId = await getLegacyAppDeploymentId(client, environmentId, tempPackage, 'device', device.id);
      if (!tempAppDeploymentId) {
        failures.push({ iteration: i, type: 'app_trigger_missing_legacy_row', package: tempPackage });
      } else {
        const appDelete = await api(baseUrl, apiKey, `/api/apps/deployments/${tempAppDeploymentId}`, {
          method: 'DELETE',
        });
        ({ device: deviceDeriv } = await getTargetDerivatives(client, tempPolicyId, group.id, device.id));
        const removed = !listApplications(deviceDeriv).some((a) => a && a.packageName === tempPackage);
        logStep(`Iteration ${i} AppCleanup`, {
          delete: appDelete.amapi_sync ?? appDelete,
          removed_from_device_derivative: removed,
        });
        if (!removed) failures.push({ iteration: i, type: 'app_trigger_cleanup_failed', package: tempPackage });
      }

      // Trigger 2: network/APN assignment change (Wi-Fi device scope) -> derivative should include/remove temp SSID
      const tempSsid = `HAMMER_${Date.now()}_${i}`;
      const netDeploy = await api(baseUrl, apiKey, '/api/networks/deploy', {
        method: 'POST',
        body: json({
          environment_id: environmentId,
          scope_type: 'device',
          scope_id: device.id,
          name: `Hammer ${i}`,
          ssid: tempSsid,
          hidden_ssid: false,
          auto_connect: true,
        }),
      });
      const netDeploymentId = netDeploy?.deployment?.id ?? null;
      ({ device: deviceDeriv } = await getTargetDerivatives(client, tempPolicyId, group.id, device.id));
      const hasTempNetwork = listOncNetworks(deviceDeriv).some((n) => n?.WiFi?.SSID === tempSsid);
      logStep(`Iteration ${i} NetworkTrigger`, {
        deploy: netDeploy.amapi_sync ?? netDeploy,
        ssid: tempSsid,
        deployment_id: netDeploymentId,
        present_in_device_derivative: hasTempNetwork,
      });
      if (!hasTempNetwork) failures.push({ iteration: i, type: 'network_trigger_missing_in_derivative', ssid: tempSsid });
      if (!netDeploymentId) {
        failures.push({ iteration: i, type: 'network_trigger_missing_deployment_id', ssid: tempSsid });
      } else {
        const netDelete = await api(baseUrl, apiKey, `/api/networks/${netDeploymentId}`, { method: 'DELETE' });
        ({ device: deviceDeriv } = await getTargetDerivatives(client, tempPolicyId, group.id, device.id));
        const removed = !listOncNetworks(deviceDeriv).some((n) => n?.WiFi?.SSID === tempSsid);
        logStep(`Iteration ${i} NetworkCleanup`, {
          delete: netDelete.amapi_sync ?? netDelete,
          removed_from_device_derivative: removed,
        });
        if (!removed) failures.push({ iteration: i, type: 'network_trigger_cleanup_failed', ssid: tempSsid });
      }

      // Trigger 4a: explicit device override -> derivative should reflect override, then reset
      const overrideValue = i % 2 === 0;
      const overrideSave = await api(baseUrl, apiKey, '/api/policies/overrides', {
        method: 'PUT',
        body: json({
          policy_id: tempPolicyId,
          scope_type: 'device',
          scope_id: device.id,
          override_config: {
            cameraDisabled: overrideValue,
          },
        }),
      });
      ({ device: deviceDeriv } = await getTargetDerivatives(client, tempPolicyId, group.id, device.id));
      const cameraDisabledAfterSave = deviceDeriv?.config?.cameraDisabled;
      logStep(`Iteration ${i} OverrideTrigger`, {
        save: overrideSave.derivative_sync ?? overrideSave,
        cameraDisabled: cameraDisabledAfterSave,
      });
      if (cameraDisabledAfterSave !== overrideValue) {
        failures.push({
          iteration: i,
          type: 'override_trigger_mismatch',
          expected: overrideValue,
          actual: cameraDisabledAfterSave ?? null,
        });
      }

      const overrideReset = await api(
        baseUrl,
        apiKey,
        `/api/policies/overrides?policy_id=${tempPolicyId}&scope_type=device&scope_id=${device.id}`,
        { method: 'DELETE' }
      );
      ({ device: deviceDeriv } = await getTargetDerivatives(client, tempPolicyId, group.id, device.id));
      const cameraDisabledAfterReset = deviceDeriv?.config?.cameraDisabled;
      logStep(`Iteration ${i} OverrideCleanup`, {
        reset: overrideReset.derivative_sync ?? overrideReset,
        cameraDisabled: cameraDisabledAfterReset ?? null,
      });
      if (cameraDisabledAfterReset !== undefined) {
        failures.push({
          iteration: i,
          type: 'override_cleanup_failed',
          actual: cameraDisabledAfterReset,
        });
      }

      // Trigger 4b: lock changes (group assignment locks) should save and clear via policy-assign
      const lockSet = await api(baseUrl, apiKey, '/api/policies/assign', {
        method: 'POST',
        body: json({
          policy_id: tempPolicyId,
          scope_type: 'group',
          scope_id: group.id,
          locked: false,
          locked_sections: ['cameraDisabled'],
        }),
      });
      const lockStateSet = await getPolicyAssignmentLocks(client, 'group', group.id);
      const setHasCameraLock = Array.isArray(lockStateSet?.locked_sections) && lockStateSet.locked_sections.includes('cameraDisabled');
      logStep(`Iteration ${i} LockTrigger`, {
        assign: lockSet.amapi_sync ?? lockSet,
        assignment_policy_id: lockStateSet?.policy_id ?? null,
        locked: lockStateSet?.locked ?? null,
        locked_sections: lockStateSet?.locked_sections ?? [],
      });
      if (lockStateSet?.policy_id !== tempPolicyId || !setHasCameraLock) {
        failures.push({ iteration: i, type: 'lock_trigger_set_failed', lock_state: lockStateSet ?? null });
      }

      const lockClear = await api(baseUrl, apiKey, '/api/policies/assign', {
        method: 'POST',
        body: json({
          policy_id: tempPolicyId,
          scope_type: 'group',
          scope_id: group.id,
          locked: false,
          locked_sections: [],
        }),
      });
      const lockStateClear = await getPolicyAssignmentLocks(client, 'group', group.id);
      const clearSections = Array.isArray(lockStateClear?.locked_sections) ? lockStateClear.locked_sections : [];
      logStep(`Iteration ${i} LockCleanup`, {
        assign: lockClear.amapi_sync ?? lockClear,
        locked: lockStateClear?.locked ?? null,
        locked_sections: clearSections,
      });
      if (lockStateClear?.policy_id !== tempPolicyId || (lockStateClear?.locked ?? false) !== false || clearSections.length > 0) {
        failures.push({ iteration: i, type: 'lock_trigger_clear_failed', lock_state: lockStateClear ?? null });
      }
    }

    if (nestedDepth > 0) {
      const depth = Math.min(Math.floor(nestedDepth), 10);
      const nestedGroups = [];
      let parentGroupId = group.id;
      for (let level = 1; level <= depth; level += 1) {
        const createdGroup = await api(baseUrl, apiKey, '/api/groups/create', {
          method: 'POST',
          body: json({
            environment_id: environmentId,
            name: `HAMMER-NEST-${Date.now()}-${level}`,
            parent_group_id: parentGroupId,
          }),
        });
        const g = createdGroup?.group ?? null;
        if (!g?.id) {
          failures.push({ type: 'nested_group_create_failed', level, response: createdGroup });
          break;
        }
        if (!nestedRootGroupId) nestedRootGroupId = g.id;
        nestedGroupIds.push(g.id);
        nestedGroups.push({ level, id: g.id, parent_group_id: parentGroupId });
        parentGroupId = g.id;
      }

      logStep('NestedGroupsCreated', { requested_depth: nestedDepth, created_depth: nestedGroups.length });
      if (nestedGroups.length === 0) {
        failures.push({ type: 'nested_group_create_none' });
      } else {
        const deepestGroup = nestedGroups[nestedGroups.length - 1];
        await api(baseUrl, apiKey, `/api/devices/${device.id}`, {
          method: 'PUT',
          body: json({ group_id: deepestGroup.id }),
        });
        const movedGroupId = await getDeviceGroupId(client, device.id);
        logStep('NestedDeviceMove', {
          device_id: device.id,
          expected_group_id: deepestGroup.id,
          actual_group_id: movedGroupId,
        });
        if (movedGroupId !== deepestGroup.id) {
          failures.push({ type: 'nested_device_move_failed', expected: deepestGroup.id, actual: movedGroupId });
        }

        const reassign = await api(baseUrl, apiKey, '/api/policies/assign', {
          method: 'POST',
          body: json({
            policy_id: tempPolicyId,
            scope_type: 'group',
            scope_id: group.id,
          }),
        });
        logStep('NestedReassignRoot', reassign.amapi_sync ?? reassign);

        // Intentionally skip levels so inheritance must bridge gaps.
        const candidates = [2, 5, 9].filter((idx) => idx <= nestedGroups.length);
        if (candidates.length === 0) candidates.push(nestedGroups.length);
        const staged = candidates.map((level, idx) => ({
          level,
          groupId: nestedGroups[level - 1].id,
          value: idx % 2 === 0,
        }));

        for (const step of staged) {
          const save = await api(baseUrl, apiKey, '/api/policies/overrides', {
            method: 'PUT',
            body: json({
              policy_id: tempPolicyId,
              scope_type: 'group',
              scope_id: step.groupId,
              override_config: { cameraDisabled: step.value },
            }),
          });
          const deviceDeriv = await getDerivativeForScope(client, tempPolicyId, 'device', device.id);
          const actual = deviceDeriv?.config?.cameraDisabled;
          logStep(`NestedOverrideSet L${step.level}`, {
            save: save.derivative_sync ?? save,
            expected_cameraDisabled: step.value,
            actual_cameraDisabled: actual ?? null,
            inherited_to_deepest: true,
          });
          if (actual !== step.value) {
            failures.push({
              type: 'nested_override_set_mismatch',
              level: step.level,
              expected: step.value,
              actual: actual ?? null,
            });
          }
        }

        for (let s = staged.length - 1; s >= 0; s -= 1) {
          const step = staged[s];
          const reset = await api(
            baseUrl,
            apiKey,
            `/api/policies/overrides?policy_id=${tempPolicyId}&scope_type=group&scope_id=${step.groupId}`,
            { method: 'DELETE' }
          );
          const deviceDeriv = await getDerivativeForScope(client, tempPolicyId, 'device', device.id);
          const expectedFallback = s > 0 ? staged[s - 1].value : undefined;
          const actual = deviceDeriv?.config?.cameraDisabled;
          logStep(`NestedOverrideReset L${step.level}`, {
            reset: reset.derivative_sync ?? reset,
            expected_cameraDisabled: expectedFallback ?? null,
            actual_cameraDisabled: actual ?? null,
            skipped_levels_between_overrides: true,
          });
          if (expectedFallback === undefined) {
            if (actual !== undefined) {
              failures.push({
                type: 'nested_override_reset_expected_unset',
                level: step.level,
                actual,
              });
            }
          } else if (actual !== expectedFallback) {
            failures.push({
              type: 'nested_override_fallback_mismatch',
              level: step.level,
              expected: expectedFallback,
              actual: actual ?? null,
            });
          }
        }
      }
    }
  } finally {
    if (target?.device?.id && originalDeviceGroupId) {
      try {
        await api(baseUrl, apiKey, `/api/devices/${target.device.id}`, {
          method: 'PUT',
          body: json({ group_id: originalDeviceGroupId }),
        });
        logStep('RestoredDeviceGroup', { device_id: target.device.id, group_id: originalDeviceGroupId });
      } catch (err) {
        failures.push({ type: 'restore_device_group_failed', error: String(err) });
      }
    }
    if (nestedRootGroupId) {
      try {
        await api(baseUrl, apiKey, `/api/groups/${nestedRootGroupId}`, { method: 'DELETE' });
        logStep('DeletedNestedGroupTree', { root_group_id: nestedRootGroupId, count_created: nestedGroupIds.length });
      } catch (err) {
        failures.push({ type: 'nested_group_cleanup_failed', root_group_id: nestedRootGroupId, error: String(err) });
      }
    }
    if (target?.group?.id && originalGroupPolicyId) {
      try {
        await api(baseUrl, apiKey, '/api/policies/assign', {
          method: 'POST',
          body: json({
            policy_id: originalGroupPolicyId,
            scope_type: 'group',
            scope_id: target.group.id,
          }),
        });
        await api(baseUrl, apiKey, `/api/devices/${target.device.id}`, { method: 'POST' });
        logStep('RestoredGroupAssignment', { group_id: target.group.id, policy_id: originalGroupPolicyId });
      } catch (err) {
        failures.push({ type: 'restore_failed', error: String(err) });
      }
    }
    if (target?.device?.id && originalDeviceAssignment?.policy_id) {
      try {
        await api(baseUrl, apiKey, '/api/policies/assign', {
          method: 'POST',
          body: json({
            policy_id: originalDeviceAssignment.policy_id,
            scope_type: 'device',
            scope_id: target.device.id,
            locked: !!originalDeviceAssignment.locked,
            locked_sections: Array.isArray(originalDeviceAssignment.locked_sections)
              ? originalDeviceAssignment.locked_sections
              : [],
          }),
        });
        await api(baseUrl, apiKey, `/api/devices/${target.device.id}`, { method: 'POST' });
        logStep('RestoredDeviceAssignment', {
          device_id: target.device.id,
          policy_id: originalDeviceAssignment.policy_id,
          locked: !!originalDeviceAssignment.locked,
          locked_sections: Array.isArray(originalDeviceAssignment.locked_sections)
            ? originalDeviceAssignment.locked_sections
            : [],
        });
      } catch (err) {
        failures.push({ type: 'restore_device_assignment_failed', error: String(err) });
      }
    }
    await client.end();
  }

  logStep('Summary', {
    failures: failures.length,
    items: failures,
    temp_policy_id: tempPolicyId,
  });
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
