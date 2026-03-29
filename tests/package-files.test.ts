import { describe, expect, test } from 'bun:test'
import { join } from 'path'

const repoRoot = join(import.meta.dir, '..')

async function getPackFiles() {
  const proc = Bun.spawn(['npm', 'pack', '--dry-run', '--json'], {
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: Bun.env,
  })

  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  if (exitCode !== 0) {
    throw new Error(`npm pack --dry-run failed: ${stderr || stdout}`)
  }

  const parsed = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>
  return parsed[0]?.files.map((file) => file.path).sort() ?? []
}

describe('published package contents', () => {
  test('includes dashboard runtime bridge and built runtime artifacts', async () => {
    const files = await getPackFiles()
    expect(files).toContain('dashboard/lib/runtime.ts')
    expect(files).toContain('dist/api.js')
    expect(files).toContain('dist/server.js')
    expect(files).toContain('dist/deploy.js')
    expect(files).toContain('dist/deps.js')
    expect(files).toContain('dist/log-rotation.js')
  })

  test('does not ship runtime src tree anymore', async () => {
    const files = await getPackFiles()
    expect(files.some((file) => file.startsWith('src/'))).toBe(false)
  })
})
