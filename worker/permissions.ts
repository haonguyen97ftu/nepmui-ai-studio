import policies from '../shared/endpoint-policy.json'
import type { Role } from './accounts'
export { policies }
export function endpointPolicy(method:string,path:string) {
  return policies.find(policy=>policy.method===method && new RegExp('^'+policy.path.replace(/:[^/]+/g,'[^/]+')+'$').test(path))
}
export function permitted(role:Role|'unauthenticated',method:string,path:string) {
  return endpointPolicy(method,path)?.roles.includes(role)===true
}
