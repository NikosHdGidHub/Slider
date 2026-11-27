import type { Resource, WorkingResource } from './resources'

export type ImageGroup = {
  key: string
  sha: string | null
  private?: WorkingResource
  public: Resource[]
}

export function groupCloudImages(
  legacy: Resource[],
  working: WorkingResource[]
): ImageGroup[] {
  const groups = new Map<string, ImageGroup>()
  const ensure = (key: string, sha: string | null) => {
    let group = groups.get(key)
    if (!group) {
      group = { key, sha, public: [] }
      groups.set(key, group)
    }
    return group
  }
  for (const row of legacy) {
    if (
      row.bucket !== 'images' ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(row.mime)
    )
      continue
    const sha = row.sha && /^[0-9a-f]{64}$/.test(row.sha) ? row.sha : null
    const group = ensure(sha ?? row.bucket + '/' + row.path, sha)
    if (!group.public.some((r) => r.path === row.path)) group.public.push(row)
  }
  for (const row of working) {
    if (!/^[0-9a-f]{64}$/.test(row.sha) || !row.mime.startsWith('image/'))
      continue
    ensure(row.sha, row.sha).private = row
  }
  return [...groups.values()]
}
