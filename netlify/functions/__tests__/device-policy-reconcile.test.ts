import {beforeEach,describe,it,expect,vi} from 'vitest';
vi.mock('../_lib/db.js',()=>({queryOne:vi.fn(),withClient:vi.fn()}));
vi.mock('../_lib/policy-derivatives.js',()=>({assignPolicyToDeviceWithDerivative:vi.fn(),getPolicyAmapiContext:vi.fn()}));
vi.mock('../_lib/audit.js',()=>({logAudit:vi.fn()}));
import {queryOne,withClient} from '../_lib/db.js';
import {assignPolicyToDeviceWithDerivative,getPolicyAmapiContext} from '../_lib/policy-derivatives.js';
import {logAudit} from '../_lib/audit.js';
import {reconcileDevicePolicy} from '../_lib/device-policy-reconcile.js';
const client={query:vi.fn()};
const device={id:'device',environment_id:'env',group_id:'group',amapi_name:'enterprises/fixture/devices/fixture',policy_id:'policy',config:{cameraDisabled:true,applications:[{}],deviceConnectivityManagement:{usbDataAccess:'ALLOW_USB_DATA_TRANSFER',apnPolicy:{}}}};
beforeEach(()=>{
  vi.clearAllMocks();
  client.query.mockResolvedValue({rows:[{locked:true}]});
  vi.mocked(withClient).mockImplementation(async fn=>fn(client as never));
  vi.mocked(queryOne).mockResolvedValue(device);
  vi.mocked(getPolicyAmapiContext).mockResolvedValue({workspace_id:'workspace'} as never);
  vi.mocked(assignPolicyToDeviceWithDerivative).mockResolvedValue({} as never);
});
describe('durable current-device policy reconciliation',()=>{
  it('preserves authored connectivity settings while regenerating deployment fields',async()=>{
    await reconcileDevicePolicy('device');
    expect(assignPolicyToDeviceWithDerivative).toHaveBeenCalledWith(expect.objectContaining({policyId:'policy',baseConfig:{cameraDisabled:true,deviceConnectivityManagement:{usbDataAccess:'ALLOW_USB_DATA_TRANSFER'}}}));
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({actor_type:'system',action:'device.policy_reconciled'}));
    expect(client.query).toHaveBeenLastCalledWith(expect.stringContaining('pg_advisory_unlock'),['device']);
  });
  it('re-reads identity and reconciles again when the group changes during delivery',async()=>{
    const changed={...device,group_id:'new-group',policy_id:'new-policy'};
    vi.mocked(queryOne).mockResolvedValueOnce(device).mockResolvedValue(changed);
    await reconcileDevicePolicy('device');
    expect(assignPolicyToDeviceWithDerivative).toHaveBeenCalledTimes(2);
    expect(assignPolicyToDeviceWithDerivative).toHaveBeenLastCalledWith(expect.objectContaining({policyId:'new-policy'}));
  });
  it('propagates provider failure for queue retry and always releases the lock',async()=>{
    vi.mocked(assignPolicyToDeviceWithDerivative).mockRejectedValueOnce(new Error('fixture provider failure'));
    await expect(reconcileDevicePolicy('device')).rejects.toThrow('fixture provider failure');
    expect(client.query).toHaveBeenLastCalledWith(expect.stringContaining('pg_advisory_unlock'),['device']);
    expect(logAudit).not.toHaveBeenCalled();
  });
  it('skips a removed device and reports an unbound environment explicitly',async()=>{
    vi.mocked(queryOne).mockResolvedValueOnce(null);
    await reconcileDevicePolicy('device');
    expect(assignPolicyToDeviceWithDerivative).not.toHaveBeenCalled();
    vi.mocked(getPolicyAmapiContext).mockResolvedValueOnce(null);
    await reconcileDevicePolicy('device');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({action:'device.policy_reconciliation_skipped',details:{reason:'environment_unbound'}}));
  });
  it('fails a bound device with no effective policy rather than claiming convergence',async()=>{
    vi.mocked(queryOne).mockResolvedValue({...device,policy_id:null});
    await expect(reconcileDevicePolicy('device')).rejects.toThrow('No effective policy');
    expect(assignPolicyToDeviceWithDerivative).not.toHaveBeenCalled();
  });
});
