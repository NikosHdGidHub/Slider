export async function digest(blob: Blob) {
  const bytes = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(bytes), (n) =>
    n.toString(16).padStart(2, '0')
  ).join('')
}
