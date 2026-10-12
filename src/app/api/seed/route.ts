import { ensureWorkspaceData } from '@/lib/workspace'

/** POST /api/seed — idempotent demo-data bootstrap (first boot / guest preview). */
export async function POST() {
  return ensureWorkspaceData(null)
}
