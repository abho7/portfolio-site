/* =============================================================================
   Live Raft cluster simulator.

   A direct port of raft-chaos-testing/raft-engine/src/raft/{node,log,
   simulator}.py to plain JS -- same method names, same tick-driven design,
   same Figure-8 commit-index safety rule -- so it stays checkable against
   the Python source it mirrors. Runs entirely client-side: no network, no
   dependency on the deployed report.

   Visualization reuses window.renderRaftTimeline (main.js's renderTimeline,
   exposed globally) so this draws in the exact same leader-band/fault-window
   visual language as the live report embed elsewhere on this page, fed from
   a scenario object this file builds incrementally every tick instead of
   fetching one once from results.json.
============================================================================= */

(function () {
  "use strict";

  /* ------------------------------------------------------------ prng */
  // Seeded PRNG so each node's election-timeout jitter is reproducible
  // per run, mirroring Python's random.Random(seed) usage in node.py.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashSeed(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return (h ^ (h >>> 16)) >>> 0;
  }

  /* ------------------------------------------------------------ log */
  // Port of raft/log.py. 1-based indices, index 0 is the sentinel.
  class ReplicatedLog {
    constructor() {
      this.entries = [];
    }
    get lastIndex() {
      return this.entries.length;
    }
    get lastTerm() {
      return this.entries.length ? this.entries[this.entries.length - 1].term : 0;
    }
    termAt(index) {
      if (index <= 0 || index > this.entries.length) return 0;
      return this.entries[index - 1].term;
    }
    get(index) {
      if (index <= 0 || index > this.entries.length) return null;
      return this.entries[index - 1];
    }
    sliceFrom(index) {
      if (index <= 0) return this.entries.slice();
      return this.entries.slice(index - 1);
    }
    append(entry) {
      this.entries.push(entry);
    }
    truncateFrom(index) {
      this.entries = index <= 0 ? [] : this.entries.slice(0, index - 1);
    }
    matches(index, term) {
      if (index === 0) return true;
      return this.termAt(index) === term;
    }
  }

  const ROLE = { FOLLOWER: "follower", CANDIDATE: "candidate", LEADER: "leader" };

  function newActions() {
    return { messages: [], committedEntries: [], becameLeader: false };
  }
  function extendActions(a, b) {
    a.messages.push(...b.messages);
    a.committedEntries.push(...b.committedEntries);
    a.becameLeader = a.becameLeader || b.becameLeader;
    return a;
  }

  /* --------------------------------------------------------- raft node */
  // Port of raft/node.py's RaftNode. Every handler returns the same
  // {messages, committedEntries, becameLeader} shape as the Python Actions
  // dataclass; the simulator below is what actually delivers `messages`.
  class RaftNode {
    constructor(nodeId, peerIds, opts) {
      opts = opts || {};
      this.nodeId = nodeId;
      this.peerIds = peerIds.slice();
      this.clusterSize = this.peerIds.length + 1;
      const seed = opts.randomSeed !== undefined && opts.randomSeed !== null ? opts.randomSeed : nodeId;
      this._rng = mulberry32(hashSeed(String(seed)));

      this.currentTerm = 0;
      this.votedFor = null;
      this.log = new ReplicatedLog();

      this.role = ROLE.FOLLOWER;
      this.commitIndex = 0;
      this.lastApplied = 0;
      this.leaderId = null;

      this.nextIndex = {};
      this.matchIndex = {};

      this.votesReceived = new Set();
      this._electionTimeoutRange = opts.electionTimeoutTicks || [10, 20];
      this._heartbeatInterval = opts.heartbeatIntervalTicks || 3;
      this.electionElapsed = 0;
      this.electionTimeout = this._randomElectionTimeout();
      this.heartbeatElapsed = 0;
    }

    _randomElectionTimeout() {
      const [lo, hi] = this._electionTimeoutRange;
      return lo + Math.floor(this._rng() * (hi - lo + 1));
    }

    tick() {
      const actions = newActions();
      if (this.role === ROLE.FOLLOWER || this.role === ROLE.CANDIDATE) {
        this.electionElapsed++;
        if (this.electionElapsed >= this.electionTimeout) extendActions(actions, this._startElection());
      } else if (this.role === ROLE.LEADER) {
        this.heartbeatElapsed++;
        if (this.heartbeatElapsed >= this._heartbeatInterval) {
          this.heartbeatElapsed = 0;
          extendActions(actions, this._sendAppendEntriesToAll());
        }
      }
      return actions;
    }

    _startElection() {
      this.role = ROLE.CANDIDATE;
      this.currentTerm += 1;
      this.votedFor = this.nodeId;
      this.votesReceived = new Set([this.nodeId]);
      this.leaderId = null;
      this.electionElapsed = 0;
      this.electionTimeout = this._randomElectionTimeout();

      const actions = newActions();
      if (this.peerIds.length === 0) {
        extendActions(actions, this._becomeLeader());
        return actions;
      }
      const req = {
        type: "RequestVoteRequest",
        term: this.currentTerm,
        candidateId: this.nodeId,
        lastLogIndex: this.log.lastIndex,
        lastLogTerm: this.log.lastTerm,
      };
      for (const peer of this.peerIds) actions.messages.push([peer, req]);
      return actions;
    }

    handleRequestVote(senderId, req) {
      if (req.term > this.currentTerm) this._stepDown(req.term);

      let voteGranted = false;
      if (req.term >= this.currentTerm) {
        const logOk =
          req.lastLogTerm > this.log.lastTerm ||
          (req.lastLogTerm === this.log.lastTerm && req.lastLogIndex >= this.log.lastIndex);
        const canVote = this.votedFor === null || this.votedFor === req.candidateId;
        if (req.term === this.currentTerm && canVote && logOk) {
          voteGranted = true;
          this.votedFor = req.candidateId;
          this.electionElapsed = 0;
        }
      }
      const resp = { type: "RequestVoteResponse", term: this.currentTerm, voteGranted, voterId: this.nodeId };
      return { messages: [[senderId, resp]], committedEntries: [], becameLeader: false };
    }

    handleRequestVoteResponse(senderId, resp) {
      if (resp.term > this.currentTerm) {
        this._stepDown(resp.term);
        return newActions();
      }
      if (this.role !== ROLE.CANDIDATE || resp.term !== this.currentTerm) return newActions();

      if (resp.voteGranted) {
        this.votesReceived.add(senderId);
        if (this.votesReceived.size * 2 > this.clusterSize) return this._becomeLeader();
      }
      return newActions();
    }

    _becomeLeader() {
      this.role = ROLE.LEADER;
      this.leaderId = this.nodeId;
      this.nextIndex = {};
      this.matchIndex = {};
      for (const peer of this.peerIds) {
        this.nextIndex[peer] = this.log.lastIndex + 1;
        this.matchIndex[peer] = 0;
      }
      this.heartbeatElapsed = 0;
      const actions = this._sendAppendEntriesToAll();
      actions.becameLeader = true;
      return actions;
    }

    _stepDown(newTerm) {
      this.currentTerm = newTerm;
      this.votedFor = null;
      this.role = ROLE.FOLLOWER;
      this.leaderId = null;
      this.electionElapsed = 0;
      this.electionTimeout = this._randomElectionTimeout();
    }

    _sendAppendEntriesToAll() {
      const actions = newActions();
      for (const peer of this.peerIds) extendActions(actions, this._sendAppendEntriesTo(peer));
      return actions;
    }

    _sendAppendEntriesTo(peerId) {
      const nextIdx = this.nextIndex[peerId] !== undefined ? this.nextIndex[peerId] : this.log.lastIndex + 1;
      const prevLogIndex = nextIdx - 1;
      const prevLogTerm = this.log.termAt(prevLogIndex);
      const entries = this.log.sliceFrom(nextIdx);
      const req = {
        type: "AppendEntriesRequest",
        term: this.currentTerm,
        leaderId: this.nodeId,
        prevLogIndex,
        prevLogTerm,
        entries,
        leaderCommit: this.commitIndex,
      };
      return { messages: [[peerId, req]], committedEntries: [], becameLeader: false };
    }

    handleAppendEntries(senderId, req) {
      if (req.term > this.currentTerm) this._stepDown(req.term);

      if (req.term < this.currentTerm) {
        const resp = { type: "AppendEntriesResponse", term: this.currentTerm, success: false, responderId: this.nodeId, matchIndex: 0 };
        return { messages: [[senderId, resp]], committedEntries: [], becameLeader: false };
      }

      this.role = ROLE.FOLLOWER;
      this.leaderId = req.leaderId;
      this.electionElapsed = 0;

      if (!this.log.matches(req.prevLogIndex, req.prevLogTerm)) {
        const resp = { type: "AppendEntriesResponse", term: this.currentTerm, success: false, responderId: this.nodeId, matchIndex: 0 };
        return { messages: [[senderId, resp]], committedEntries: [], becameLeader: false };
      }

      for (let i = 0; i < req.entries.length; i++) {
        const entry = req.entries[i];
        const idx = req.prevLogIndex + 1 + i;
        const existing = this.log.get(idx);
        if (existing !== null && existing.term !== entry.term) {
          this.log.truncateFrom(idx);
          this.log.append(entry);
        } else if (existing === null) {
          this.log.append(entry);
        }
      }

      const matchIndexReply = req.prevLogIndex + req.entries.length;
      if (req.leaderCommit > this.commitIndex) this.commitIndex = Math.min(req.leaderCommit, this.log.lastIndex);

      const resp = { type: "AppendEntriesResponse", term: this.currentTerm, success: true, responderId: this.nodeId, matchIndex: matchIndexReply };
      const actions = { messages: [[senderId, resp]], committedEntries: [], becameLeader: false };
      actions.committedEntries = this._applyCommittedEntries();
      return actions;
    }

    handleAppendEntriesResponse(senderId, resp) {
      if (resp.term > this.currentTerm) {
        this._stepDown(resp.term);
        return newActions();
      }
      if (this.role !== ROLE.LEADER || resp.term !== this.currentTerm) return newActions();

      if (resp.success) {
        this.matchIndex[senderId] = Math.max(this.matchIndex[senderId] || 0, resp.matchIndex);
        this.nextIndex[senderId] = this.matchIndex[senderId] + 1;
        this._advanceCommitIndex();
        return { messages: [], committedEntries: this._applyCommittedEntries(), becameLeader: false };
      }
      this.nextIndex[senderId] = Math.max(
        1,
        (this.nextIndex[senderId] !== undefined ? this.nextIndex[senderId] : this.log.lastIndex + 1) - 1
      );
      return this._sendAppendEntriesTo(senderId);
    }

    _advanceCommitIndex() {
      // Figure-8 safety rule: only ever advance commitIndex by directly
      // counting replicas for an entry from the LEADER'S OWN current term.
      for (let n = this.log.lastIndex; n > this.commitIndex; n--) {
        if (this.log.termAt(n) !== this.currentTerm) continue;
        let replicaCount = 1;
        for (const peer of this.peerIds) if ((this.matchIndex[peer] || 0) >= n) replicaCount++;
        if (replicaCount * 2 > this.clusterSize) {
          this.commitIndex = n;
          return;
        }
      }
    }

    _applyCommittedEntries() {
      const applied = [];
      while (this.lastApplied < this.commitIndex) {
        this.lastApplied += 1;
        const entry = this.log.get(this.lastApplied);
        if (entry) applied.push(entry);
      }
      return applied;
    }

    propose(command) {
      if (this.role !== ROLE.LEADER) return [null, newActions()];
      const entry = { term: this.currentTerm, index: this.log.lastIndex + 1, command };
      this.log.append(entry);
      const actions = this._sendAppendEntriesToAll();
      return [entry, actions];
    }
  }

  /* ------------------------------------------------------ simulated cluster */
  // Port of raft/simulator.py's SimulatedCluster. Message delivery within a
  // tick is immediate and recursive, exactly as in the Python.
  class SimulatedCluster {
    constructor(nodeIds, opts) {
      opts = opts || {};
      this.nodeIds = nodeIds.slice();
      this.electionTimeoutTicks = opts.electionTimeoutTicks || [10, 20];
      this.heartbeatIntervalTicks = opts.heartbeatIntervalTicks || 3;
      this.dropRate = opts.dropRate || 0;
      this.seedBase = opts.seed !== undefined ? opts.seed : 0;

      this.nodes = {};
      for (const nid of nodeIds) {
        this.nodes[nid] = new RaftNode(nid, nodeIds.filter((p) => p !== nid), {
          electionTimeoutTicks: this.electionTimeoutTicks,
          heartbeatIntervalTicks: this.heartbeatIntervalTicks,
          randomSeed: `${this.seedBase}-${nid}`,
        });
      }
      this.alive = {};
      for (const nid of nodeIds) this.alive[nid] = true;
      this._partition = null;
      this._rng = mulberry32(hashSeed(String(this.seedBase)));
      this.currentTick = 0;
    }

    killNode(nodeId) {
      this.alive[nodeId] = false;
    }

    restartNode(nodeId) {
      const old = this.nodes[nodeId];
      const fresh = new RaftNode(nodeId, old.peerIds, {
        electionTimeoutTicks: this.electionTimeoutTicks,
        heartbeatIntervalTicks: this.heartbeatIntervalTicks,
        randomSeed: `restart-${this.currentTick}-${nodeId}`,
      });
      fresh.currentTerm = old.currentTerm;
      fresh.votedFor = old.votedFor;
      fresh.log = old.log; // only persistent state survives a restart
      this.nodes[nodeId] = fresh;
      this.alive[nodeId] = true;
    }

    partition(groupA, groupB) {
      this._partition = [new Set(groupA), new Set(groupB)];
    }
    healPartition() {
      this._partition = null;
    }

    _canDeliver(senderId, recipientId) {
      if (!this.alive[senderId] || !this.alive[recipientId]) return false;
      if (this._partition) {
        const [a, b] = this._partition;
        if ((a.has(senderId) && b.has(recipientId)) || (b.has(senderId) && a.has(recipientId))) return false;
      }
      return true;
    }

    tick() {
      this.currentTick += 1;
      for (const nid of Object.keys(this.nodes)) {
        if (!this.alive[nid]) continue;
        this._handleActions(nid, this.nodes[nid].tick());
      }
    }

    _handleActions(senderId, actions) {
      for (const [recipientId, message] of actions.messages) this._deliver(senderId, recipientId, message);
    }

    _deliver(senderId, recipientId, message) {
      if (!this._canDeliver(senderId, recipientId)) return;
      if (this.dropRate > 0 && this._rng() < this.dropRate) return;

      const target = this.nodes[recipientId];
      let actions;
      switch (message.type) {
        case "RequestVoteRequest":
          actions = target.handleRequestVote(senderId, message);
          break;
        case "RequestVoteResponse":
          actions = target.handleRequestVoteResponse(senderId, message);
          break;
        case "AppendEntriesRequest":
          actions = target.handleAppendEntries(senderId, message);
          break;
        case "AppendEntriesResponse":
          actions = target.handleAppendEntriesResponse(senderId, message);
          break;
        default:
          throw new TypeError("Unknown message type: " + message.type);
      }
      this._handleActions(recipientId, actions);
    }

    propose(command) {
      for (const nid of Object.keys(this.nodes)) {
        if (this.alive[nid] && this.nodes[nid].role === ROLE.LEADER) {
          const [entry, actions] = this.nodes[nid].propose(command);
          this._handleActions(nid, actions);
          return entry;
        }
      }
      return null;
    }

    currentLeaders() {
      return Object.keys(this.nodes).filter((nid) => this.alive[nid] && this.nodes[nid].role === ROLE.LEADER);
    }
  }

  /* ------------------------------------------------------------------- UI */
  const TICK_MS = 120;
  const WINDOW_TICKS = 160;
  const REVIVE_DELAY_TICKS = 45; // ticks a killed node stays dead before auto-rejoining
  const PROPOSE_EVERY_TICKS = 7; // keeps commit_index/log activity visible and exercisable
  const MAJORITY_FLOOR = 3; // never let "Kill leader" drop alive count below this

  function clip(interval, windowStart, nowTick) {
    const end = interval.end == null ? nowTick : interval.end;
    if (end < windowStart) return null;
    const start = Math.max(interval.start, windowStart);
    return Object.assign({}, interval, { start: start - windowStart, end: end - windowStart });
  }

  function initRaftSim() {
    const timelineHost = document.getElementById("raft-timeline");
    const statusHost = document.getElementById("raft-status");
    const tickLabel = document.getElementById("raft-tick");
    const killBtn = document.getElementById("raft-kill");
    const partitionBtn = document.getElementById("raft-partition");
    const pauseBtn = document.getElementById("raft-pause");
    const resetBtn = document.getElementById("raft-reset");
    if (!timelineHost || typeof window.renderRaftTimeline !== "function") return;

    const NODE_IDS = ["n1", "n2", "n3", "n4", "n5"];

    let cluster, openLeader, leaderIntervals, openFault, faultWindows, maxCommitEver, pendingRevive, writeCounter, timerId, paused;
    let offscreen = false; // true while the card is scrolled out of view

    function reset() {
      cluster = new SimulatedCluster(NODE_IDS, { seed: Date.now() % 100000 });
      openLeader = {};
      leaderIntervals = [];
      openFault = null;
      faultWindows = [];
      maxCommitEver = 0;
      pendingRevive = null;
      writeCounter = 0;
      paused = false;
      if (pauseBtn) pauseBtn.textContent = "Pause";
      if (partitionBtn) partitionBtn.textContent = "Partition network";
      render();
    }

    function openFaultWindow(kind, label) {
      openFault = { start: cluster.currentTick, kind, label };
    }
    function closeFaultWindow() {
      if (!openFault) return;
      faultWindows.push(Object.assign({}, openFault, { end: cluster.currentTick }));
      openFault = null;
    }

    function updateHistory() {
      for (const nid of NODE_IDS) {
        const node = cluster.nodes[nid];
        const isLeader = cluster.alive[nid] && node.role === ROLE.LEADER;
        if (isLeader && !openLeader[nid]) {
          openLeader[nid] = { node: nid, start: cluster.currentTick, term: node.currentTerm };
        } else if (!isLeader && openLeader[nid]) {
          leaderIntervals.push(Object.assign({}, openLeader[nid], { end: cluster.currentTick }));
          openLeader[nid] = null;
        }
      }
      const commitMax = Math.max(0, ...NODE_IDS.map((nid) => cluster.nodes[nid].commitIndex));
      if (commitMax > maxCommitEver) maxCommitEver = commitMax;
    }

    function maybeAutoPropose() {
      if (cluster.currentTick % PROPOSE_EVERY_TICKS !== 0) return;
      const entry = cluster.propose({ op: "set", key: "k" + writeCounter, value: writeCounter });
      if (entry) writeCounter++;
    }

    function processPendingRevive() {
      if (!pendingRevive || cluster.currentTick < pendingRevive.atTick) return;
      cluster.restartNode(pendingRevive.nid);
      closeFaultWindow();
      pendingRevive = null;
      updateButtons();
    }

    function buildScenario() {
      const now = cluster.currentTick;
      const windowStart = Math.max(0, now - WINDOW_TICKS);
      const totalTicks = Math.max(1, now - windowStart);

      const openIntervals = Object.values(openLeader)
        .filter(Boolean)
        .map((iv) => Object.assign({}, iv, { end: now }));
      const allIntervals = leaderIntervals.concat(openIntervals).map((iv) => clip(iv, windowStart, now)).filter(Boolean);

      const openFaults = openFault ? [Object.assign({}, openFault, { end: now })] : [];
      const allFaults = faultWindows.concat(openFaults).map((w) => clip(w, windowStart, now)).filter(Boolean);

      return {
        name: "live simulation",
        total_ticks: totalTicks,
        nodes: NODE_IDS,
        leader_intervals: allIntervals,
        fault_windows: allFaults,
        check: { acked_writes: maxCommitEver },
      };
    }

    function renderStatus() {
      if (!statusHost) return;
      const rows = NODE_IDS.map((nid) => {
        const node = cluster.nodes[nid];
        const alive = cluster.alive[nid];
        const cls = !alive ? "dead" : node.role;
        const label = !alive ? "dead" : node.role;
        return (
          `<div class="node-row ${cls}">` +
          `<span class="node-id">${nid}</span>` +
          `<span class="node-role">${label}</span>` +
          `<span class="node-field">term ${node.currentTerm}</span>` +
          `<span class="node-field">commit ${node.commitIndex}</span>` +
          `</div>`
        );
      }).join("");
      statusHost.innerHTML = rows;
    }

    function updateButtons() {
      const leaders = cluster.currentLeaders();
      const aliveCount = NODE_IDS.filter((nid) => cluster.alive[nid]).length;
      if (killBtn) killBtn.disabled = leaders.length === 0 || aliveCount <= MAJORITY_FLOOR || !!pendingRevive;
      if (partitionBtn) partitionBtn.disabled = false;
    }

    function render() {
      window.renderRaftTimeline(timelineHost, buildScenario());
      // renderTimeline's .mini-band elements carry a one-shot "grow" CSS
      // animation meant for a single fetched-JSON render. This host re-renders
      // every tick, so left running it would restart mid-animation forever
      // and every band would sit frozen near its 2% starting width. Skip
      // straight to the settled state instead.
      timelineHost.querySelectorAll(".mini-band").forEach((el) => {
        el.style.animation = "none";
        el.style.transform = "none";
        el.style.opacity = "1";
      });
      renderStatus();
      updateButtons();
      if (tickLabel) tickLabel.textContent = `tick ${cluster.currentTick}`;

      // Published as a read-only view of the cluster for anything that wants
      // it (and as a handle for poking at the sim from the console). A plain
      // object on window rather than an event, so readers stay decoupled.
      const leaders = cluster.currentLeaders();
      window.__raftState = {
        running: !!timerId,
        tick: cluster.currentTick,
        leader: leaders[0] || null,
        term: leaders[0] ? cluster.nodes[leaders[0]].currentTerm : null,
      };
    }

    function step() {
      cluster.tick();
      updateHistory();
      maybeAutoPropose();
      processPendingRevive();
      render();
    }

    function startTimer() {
      if (timerId) return;
      timerId = setInterval(step, TICK_MS);
    }
    function stopTimer() {
      if (!timerId) return;
      clearInterval(timerId);
      timerId = null;
    }
    // Two independent reasons to be stopped -- user-requested pause and
    // being scrolled off-screen -- reconciled in one place so neither can
    // clobber the other (e.g. scrolling away and back must not silently
    // resume a cluster the visitor manually paused).
    function syncTimerState() {
      if (paused || offscreen) stopTimer();
      else startTimer();
      // render() is what normally publishes __raftState, and it stops being
      // called the moment the timer does -- so the running flag has to be
      // refreshed here too or readers would see a stale LIVE forever.
      if (window.__raftState) window.__raftState.running = !!timerId;
    }

    if (killBtn) {
      killBtn.addEventListener("click", () => {
        const leaders = cluster.currentLeaders();
        if (!leaders.length) return;
        const nid = leaders[0];
        cluster.killNode(nid);
        openFaultWindow("kill", `${nid} killed`);
        pendingRevive = { nid, atTick: cluster.currentTick + REVIVE_DELAY_TICKS };
        updateButtons();
      });
    }

    if (partitionBtn) {
      partitionBtn.addEventListener("click", () => {
        if (cluster._partition) {
          cluster.healPartition();
          closeFaultWindow();
          partitionBtn.textContent = "Partition network";
        } else {
          cluster.partition(new Set(["n1", "n2", "n3"]), new Set(["n4", "n5"]));
          openFaultWindow("partition", "network partitioned (3 / 2)");
          partitionBtn.textContent = "Heal partition";
        }
      });
    }

    if (pauseBtn) {
      pauseBtn.addEventListener("click", () => {
        paused = !paused;
        pauseBtn.textContent = paused ? "Resume" : "Pause";
        syncTimerState();
      });
    }

    if (resetBtn) resetBtn.addEventListener("click", reset);

    reset();

    // Pause the tick loop (and the innerHTML rebuild it drives every 120ms)
    // once the card scrolls out of view -- the same pattern ui-polish.js
    // already uses for the particle background, so this piece isn't doing
    // continuous DOM work that competes with scroll/paint for no reason.
    const card = timelineHost.closest(".card");
    if (card && "IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) offscreen = !entry.isIntersecting;
          syncTimerState();
        },
        { rootMargin: "200px 0px" }
      );
      io.observe(card);
    } else {
      startTimer();
    }
    // Ticking is the simulation itself, not decorative motion, so it always
    // runs while visible; prefers-reduced-motion is honoured at the CSS
    // layer (the site's blanket animation:none rule already strips the
    // band-growth transition).
  }

  window.RaftSim = { RaftNode, SimulatedCluster, ReplicatedLog };
  window.initRaftSim = initRaftSim;
})();
