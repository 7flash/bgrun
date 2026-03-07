/**
 * Process Dependency Graph
 * 
 * Defines and resolves process startup dependencies.
 * Dependencies are stored in process env as BGR_DEPENDS_ON=name1,name2
 * 
 * Features:
 * - Topological sort for startup order
 * - Cycle detection
 * - Dependency graph as adjacency list
 * - Auto-start dependencies on process run
 */

import { getAllProcesses, getProcess } from './db'
import { isProcessRunning } from './platform'
import { parseEnvString } from './utils'

export interface DepNode {
    name: string
    dependsOn: string[]      // processes this depends ON (must start first)
    dependedBy: string[]     // processes that depend on THIS
    running: boolean
    pid: number
}

export interface DepGraph {
    nodes: DepNode[]
    order: string[]          // topological sort (startup order)
    hasCycle: boolean
    cycleNodes?: string[]    // nodes involved in cycle
}

/** Parse BGR_DEPENDS_ON from a process env string */
export function getDependencies(envStr: string): string[] {
    const env = parseEnvString(envStr)
    const raw = env.BGR_DEPENDS_ON || ''
    return raw.split(',').map(s => s.trim()).filter(Boolean)
}

/** Build the full dependency graph from all registered processes */
export async function buildDepGraph(): Promise<DepGraph> {
    const processes = getAllProcesses()
    const nodeMap = new Map<string, DepNode>()

    // Phase 1: Create all nodes
    for (const proc of processes) {
        const deps = getDependencies(proc.env)
        const alive = await isProcessRunning(proc.pid, proc.command)
        nodeMap.set(proc.name, {
            name: proc.name,
            dependsOn: deps,
            dependedBy: [],
            running: alive,
            pid: proc.pid,
        })
    }

    // Phase 2: Build reverse edges (dependedBy)
    for (const node of nodeMap.values()) {
        for (const dep of node.dependsOn) {
            const depNode = nodeMap.get(dep)
            if (depNode) {
                depNode.dependedBy.push(node.name)
            }
        }
    }

    // Phase 3: Topological sort (Kahn's algorithm)
    const inDegree = new Map<string, number>()
    for (const node of nodeMap.values()) {
        inDegree.set(node.name, node.dependsOn.filter(d => nodeMap.has(d)).length)
    }

    const queue: string[] = []
    for (const [name, degree] of inDegree) {
        if (degree === 0) queue.push(name)
    }

    const order: string[] = []
    while (queue.length > 0) {
        const current = queue.shift()!
        order.push(current)

        const node = nodeMap.get(current)!
        for (const dependent of node.dependedBy) {
            const newDegree = (inDegree.get(dependent) || 0) - 1
            inDegree.set(dependent, newDegree)
            if (newDegree === 0) queue.push(dependent)
        }
    }

    const hasCycle = order.length < nodeMap.size
    const cycleNodes = hasCycle
        ? [...nodeMap.keys()].filter(n => !order.includes(n))
        : undefined

    return {
        nodes: [...nodeMap.values()],
        order,
        hasCycle,
        cycleNodes,
    }
}

/** Get unmet dependencies for a specific process */
export async function getUnmetDeps(name: string): Promise<string[]> {
    const proc = getProcess(name)
    if (!proc) return []

    const deps = getDependencies(proc.env)
    const unmet: string[] = []

    for (const depName of deps) {
        const depProc = getProcess(depName)
        if (!depProc) {
            unmet.push(depName) // dependency not even registered
            continue
        }
        const alive = await isProcessRunning(depProc.pid, depProc.command)
        if (!alive) {
            unmet.push(depName)
        }
    }

    return unmet
}
