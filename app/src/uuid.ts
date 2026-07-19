/**
 * Generates a random RFC-4122-ish v4 UUID string. Used only as a stable,
 * client-assigned identifier so shared tasks/items can be reconciled across
 * devices - not for anything security-sensitive, so Math.random is fine.
 */
export function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
