import assert from 'node:assert/strict';
/** Restore completion is not snapshot time. The protected directory is created before the snapshot transaction. */
export function assertSnapshotFresh(root,after){
 const match=/consolidation-(\d+)$/.exec(root.replaceAll('\\','/'));
 assert.ok(match&&Number.isSafeInteger(Number(match[1]))&&Number(match[1])>after,'snapshot must start after the required fence');
}
/** A resumed fence must retain the original scopes, even when the current database row is already restricted. */
export function preserveOriginalScopes(state,current){
 if(state.originalScopes===undefined){assert.ok(JSON.parse(current).includes('purchases:write'),'original write scope required');state.originalScopes=current;}
 const scopes=JSON.parse(state.originalScopes);
 assert.ok(Array.isArray(scopes)&&scopes.includes('purchases:read')&&scopes.includes('purchases:write'),'saved original scopes invalid');
 return state.originalScopes;
}
