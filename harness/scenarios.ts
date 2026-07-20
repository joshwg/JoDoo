import { SimClient } from './simClient';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let passed = 0;

function assert(cond: boolean, what: string): void {
  if (!cond) throw new Error(`assertion failed: ${what}`);
  passed++;
  console.log(`  ok - ${what}`);
}

/** Waits until every client's full record set (items AND tombstones) is
 *  identical and stays identical, i.e. the share has converged. */
async function settle(clients: SimClient[], what: string): Promise<void> {
  const allEqual = () => clients.every((c) => c.fingerprint() === clients[0].fingerprint());
  const deadline = Date.now() + 10000;
  for (;;) {
    if (allEqual()) {
      // Quiesce check: still identical shortly after, so no frames in flight.
      await sleep(200);
      if (allEqual()) break;
    }
    if (Date.now() > deadline) {
      for (const c of clients) {
        console.error(`  ${c.label}: ${JSON.stringify(c.records(), null, 2)}`);
      }
      throw new Error(`timed out waiting for convergence: ${what}`);
    }
    await sleep(25);
  }
  passed++;
  console.log(`  ok - converged: ${what}`);
}

/**
 * The full three-client scenario suite, run against whichever server
 * `httpBase` points at (a locally spawned one or a real deployment). Only
 * ever touches the freshly created share, so it is safe to run against a
 * server holding real data. Returns the number of passed checks; throws on
 * the first failure.
 */
export async function runScenarios(httpBase: string, serverKey: string): Promise<number> {
  passed = 0;
  const a = new SimClient('A', httpBase, serverKey);
  const b = new SimClient('B', httpBase, serverKey);
  const c = new SimClient('C', httpBase, serverKey);

  try {
    console.log('\nscenario: share and join');
    const alpha = a.addTask('alpha');
    const beta = a.addTask('beta');
    const key = await a.createShare('Harness Test List');
    await a.connect();
    await b.join(key);
    await b.connect();
    await settle([a, b], 'B joined the share');
    assert(b.titles().includes('alpha') && b.titles().includes('beta'), 'B received both tasks');
    assert(b.listName === 'Harness Test List', 'B received the list name');

    console.log('\nscenario: non-conflicting concurrent adds (both survive)');
    a.addTask('milk');
    b.addTask('eggs');
    await settle([a, b], 'concurrent adds merged');
    for (const peer of [a, b]) {
      assert(
        peer.titles().includes('milk') && peer.titles().includes('eggs'),
        `${peer.label} kept both new tasks`
      );
    }
    assert(a.titles().length === 4, 'no duplicates were created');

    console.log('\nscenario: same-item conflict (later change wins)');
    a.editTask(alpha, 'alpha edited by A');
    await sleep(20); // guarantee B's edit is strictly later
    b.editTask(alpha, 'alpha edited by B');
    await settle([a, b], 'conflicting edits resolved');
    assert(a.task(alpha)?.title === 'alpha edited by B', 'A adopted the later edit');
    assert(b.task(alpha)?.title === 'alpha edited by B', 'B kept the later edit');

    console.log('\nscenario: deletion propagates (and stays deleted)');
    a.deleteTask(beta);
    await settle([a, b], 'deletion synced');
    assert(!b.titles().includes('beta'), 'B no longer has the deleted task');
    assert(b.hasTombstone(beta), 'B holds the tombstone');

    console.log('\nscenario: offline edits on both sides merge on reconnect');
    b.disconnect();
    a.editTask(alpha, 'alpha while B offline');
    const offline = b.addTask('added while offline');
    a.deleteTask(a.records().find((r) => r.title === 'milk')!.uuid);
    await sleep(50);
    await b.connect();
    await settle([a, b], 'B reconnected and merged');
    assert(b.task(alpha)?.title === 'alpha while B offline', "B adopted A's offline-era edit");
    assert(a.titles().includes('added while offline'), "A received B's offline add");
    assert(!b.titles().includes('milk'), "A's deletion was not resurrected by B's return");
    assert(a.task(offline) != null && b.task(offline) != null, 'offline add exists on both');

    console.log('\nscenario: done-state conflict (later change wins)');
    b.setDone(alpha, true);
    await sleep(20);
    a.setDone(alpha, false);
    await settle([a, b], 'done-state resolved');
    assert(b.task(alpha)?.done === false, 'later un-check won on both devices');

    console.log('\nscenario: third client joins mid-flight and edits');
    await c.join(key);
    await c.connect();
    await settle([a, b, c], 'C joined the share');
    const fromC = c.addTask('added by C');
    await settle([a, b, c], "C's first edit synced");
    assert(a.task(fromC) != null && b.task(fromC) != null, "A and B received C's task");

    console.log('\nscenario: C exits, misses changes, restarts, and catches up');
    c.disconnect();
    a.editTask(fromC, "C's task edited by A while C away");
    const fromB = b.addTask('added by B while C away');
    b.deleteTask(offline);
    await settle([a, b], 'A and B converged while C away');
    await sleep(50);
    // A restart reconnects with the state the app persisted locally.
    await c.connect();
    await settle([a, b, c], 'C caught up after restart');
    assert(
      c.task(fromC)?.title === "C's task edited by A while C away",
      "C adopted A's edit to C's own task"
    );
    assert(c.task(fromB) != null, "C received B's new task");
    assert(!c.titles().includes('added while offline'), 'C learned about the deletion it missed');

    console.log('\nscenario: C edits after restart and everyone follows');
    c.editTask(fromB, "B's task edited by C");
    const fromC2 = c.addTask('second task from C');
    c.setDone(alpha, true);
    await settle([a, b, c], "C's post-restart edits synced");
    for (const peer of [a, b]) {
      assert(peer.task(fromB)?.title === "B's task edited by C", `${peer.label} adopted C's edit`);
      assert(peer.task(fromC2) != null, `${peer.label} received C's new task`);
      assert(peer.task(alpha)?.done === true, `${peer.label} saw C's done-toggle`);
    }

    console.log('\nscenario: reorder on one device shows up on the others');
    const beforeOrder = a.titles();
    a.reorder(
      a
        .records()
        .filter((r) => !r.deleted)
        .map((r) => r.uuid)
        .reverse()
    );
    await settle([a, b, c], 'reorder synced');
    assert(
      JSON.stringify(a.titles()) === JSON.stringify([...beforeOrder].reverse()),
      'A shows the reversed order'
    );
    for (const peer of [b, c]) {
      assert(
        JSON.stringify(peer.titles()) === JSON.stringify(a.titles()),
        `${peer.label} shows the same order as A`
      );
    }

    return passed;
  } finally {
    a.disconnect();
    b.disconnect();
    c.disconnect();
  }
}
