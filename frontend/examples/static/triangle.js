import { AbstractBuffer, Context, Gpu, GpuAdapter, GpuBindGroupLayout, GpuCommandBuffer, GpuCommandEncoder, GpuDevice, GpuPipelineLayout, GpuQuerySet, GpuQueue, GpuRenderPassEncoder, GpuRenderPipeline, GpuShaderModule, GpuTexture, GpuTextureView, RecordGpuPipelineConstantValue, RecordOptionGpuSize64, Surface, getGpu, poll as poll$1 } from './gfx.js';
import { stdout } from 'https://cdn.jsdelivr.net/npm/@bytecodealliance/preview2-shim/lib/browser/cli.js';
import { error, streams } from 'https://cdn.jsdelivr.net/npm/@bytecodealliance/preview2-shim/lib/browser/io.js';
const { Pollable,
  poll } = poll$1;
const { getStdout } = stdout;
const { Error: Error$1 } = error;
const { OutputStream } = streams;

let dv = new DataView(new ArrayBuffer());
const dataView = mem => dv.buffer === mem.buffer ? dv : dv = new DataView(mem.buffer);

function toUint32(val) {
  return val >>> 0;
}

const utf8Decoder = new TextDecoder();

const utf8Encoder = new TextEncoder();
let utf8EncodedLen = 0;
function utf8Encode(s, realloc, memory) {
  if (typeof s !== 'string') throw new TypeError('expected a string');
  if (s.length === 0) {
    utf8EncodedLen = 0;
    return 1;
  }
  let buf = utf8Encoder.encode(s);
  let ptr = realloc(0, 0, 1, buf.length);
  new Uint8Array(memory.buffer).set(buf, ptr);
  utf8EncodedLen = buf.length;
  return ptr;
}

const T_FLAG = 1 << 30;

function rscTableCreateOwn (table, rep) {
  const free = table[0] & ~T_FLAG;
  if (free === 0) {
    table.push(0);
    table.push(rep | T_FLAG);
    return (table.length >> 1) - 1;
  }
  table[0] = table[free << 1];
  table[free << 1] = 0;
  table[(free << 1) + 1] = rep | T_FLAG;
  return free;
}

function rscTableRemove (table, handle) {
  const scope = table[handle << 1];
  const val = table[(handle << 1) + 1];
  const own = (val & T_FLAG) !== 0;
  const rep = val & ~T_FLAG;
  if (val === 0 || (scope & T_FLAG) !== 0) throw new TypeError('Invalid handle');
  table[handle << 1] = table[0] | T_FLAG;
  table[0] = handle | T_FLAG;
  return { rep, scope, own };
}

let curResourceBorrows = [];

let NEXT_TASK_ID = 0n;
function startCurrentTask(componentIdx, isAsync, entryFnName) {
  _debugLog('[startCurrentTask()] args', { componentIdx, isAsync });
  if (componentIdx === undefined || componentIdx === null) {
    throw new Error('missing/invalid component instance index while starting task');
  }
  const tasks = ASYNC_TASKS_BY_COMPONENT_IDX.get(componentIdx);
  
  const nextId = ++NEXT_TASK_ID;
  const newTask = new AsyncTask({ id: nextId, componentIdx, isAsync, entryFnName });
  const newTaskMeta = { id: nextId, componentIdx, task: newTask };
  
  ASYNC_CURRENT_TASK_IDS.push(nextId);
  ASYNC_CURRENT_COMPONENT_IDXS.push(componentIdx);
  
  if (!tasks) {
    ASYNC_TASKS_BY_COMPONENT_IDX.set(componentIdx, [newTaskMeta]);
    return nextId;
  } else {
    tasks.push(newTaskMeta);
  }
  
  return nextId;
}

function endCurrentTask(componentIdx, taskId) {
  _debugLog('[endCurrentTask()] args', { componentIdx });
  componentIdx ??= ASYNC_CURRENT_COMPONENT_IDXS.at(-1);
  taskId ??= ASYNC_CURRENT_TASK_IDS.at(-1);
  if (componentIdx === undefined || componentIdx === null) {
    throw new Error('missing/invalid component instance index while ending current task');
  }
  const tasks = ASYNC_TASKS_BY_COMPONENT_IDX.get(componentIdx);
  if (!tasks || !Array.isArray(tasks)) {
    throw new Error('missing/invalid tasks for component instance while ending task');
  }
  if (tasks.length == 0) {
    throw new Error('no current task(s) for component instance while ending task');
  }
  
  if (taskId) {
    const last = tasks[tasks.length - 1];
    if (last.id !== taskId) {
      throw new Error('current task does not match expected task ID');
    }
  }
  
  ASYNC_CURRENT_TASK_IDS.pop();
  ASYNC_CURRENT_COMPONENT_IDXS.pop();
  
  return tasks.pop();
}
const ASYNC_TASKS_BY_COMPONENT_IDX = new Map();
const ASYNC_CURRENT_TASK_IDS = [];
const ASYNC_CURRENT_COMPONENT_IDXS = [];

class AsyncTask {
  static State = {
    INITIAL: 'initial',
    CANCELLED: 'cancelled',
    CANCEL_PENDING: 'cancel-pending',
    CANCEL_DELIVERED: 'cancel-delivered',
    RESOLVED: 'resolved',
  }
  
  static BlockResult = {
    CANCELLED: 'block.cancelled',
    NOT_CANCELLED: 'block.not-cancelled',
  }
  
  #id;
  #componentIdx;
  #state;
  #isAsync;
  #onResolve = null;
  #entryFnName = null;
  #subtasks = [];
  #completionPromise = null;
  
  cancelled = false;
  requested = false;
  alwaysTaskReturn = false;
  
  returnCalls =  0;
  storage = [0, 0];
  borrowedHandles = {};
  
  awaitableResume = null;
  awaitableCancel = null;
  
  
  constructor(opts) {
    if (opts?.id === undefined) { throw new TypeError('missing task ID during task creation'); }
    this.#id = opts.id;
    if (opts?.componentIdx === undefined) {
      throw new TypeError('missing component id during task creation');
    }
    this.#componentIdx = opts.componentIdx;
    this.#state = AsyncTask.State.INITIAL;
    this.#isAsync = opts?.isAsync ?? false;
    this.#entryFnName = opts.entryFnName;
    
    const {
      promise: completionPromise,
      resolve: resolveCompletionPromise,
      reject: rejectCompletionPromise,
    } = Promise.withResolvers();
    this.#completionPromise = completionPromise;
    
    this.#onResolve = (results) => {
      // TODO: handle external facing cancellation (should likely be a rejection)
      resolveCompletionPromise(results);
    }
  }
  
  taskState() { return this.#state.slice(); }
  id() { return this.#id; }
  componentIdx() { return this.#componentIdx; }
  isAsync() { return this.#isAsync; }
  entryFnName() { return this.#entryFnName; }
  completionPromise() { return this.#completionPromise; }
  
  mayEnter(task) {
    const cstate = getOrCreateAsyncState(this.#componentIdx);
    if (!cstate.backpressure) {
      _debugLog('[AsyncTask#mayEnter()] disallowed due to backpressure', { taskID: this.#id });
      return false;
    }
    if (!cstate.callingSyncImport()) {
      _debugLog('[AsyncTask#mayEnter()] disallowed due to sync import call', { taskID: this.#id });
      return false;
    }
    const callingSyncExportWithSyncPending = cstate.callingSyncExport && !task.isAsync;
    if (!callingSyncExportWithSyncPending) {
      _debugLog('[AsyncTask#mayEnter()] disallowed due to sync export w/ sync pending', { taskID: this.#id });
      return false;
    }
    return true;
  }
  
  async enter() {
    _debugLog('[AsyncTask#enter()] args', { taskID: this.#id });
    
    // TODO: assert scheduler locked
    // TODO: trap if on the stack
    
    const cstate = getOrCreateAsyncState(this.#componentIdx);
    
    let mayNotEnter = !this.mayEnter(this);
    const componentHasPendingTasks = cstate.pendingTasks > 0;
    if (mayNotEnter || componentHasPendingTasks) {
      throw new Error('in enter()'); // TODO: remove
      cstate.pendingTasks.set(this.#id, new Awaitable(new Promise()));
      
      const blockResult = await this.onBlock(awaitable);
      if (blockResult) {
        // TODO: find this pending task in the component
        const pendingTask = cstate.pendingTasks.get(this.#id);
        if (!pendingTask) {
          throw new Error('pending task [' + this.#id + '] not found for component instance');
        }
        cstate.pendingTasks.remove(this.#id);
        this.#onResolve(new Error('failed enter'));
        return false;
      }
      
      mayNotEnter = !this.mayEnter(this);
      if (!mayNotEnter || !cstate.startPendingTask) {
        throw new Error('invalid component entrance/pending task resolution');
      }
      cstate.startPendingTask = false;
    }
    
    if (!this.isAsync) { cstate.callingSyncExport = true; }
    
    return true;
  }
  
  async waitForEvent(opts) {
    const { waitableSetRep, isAsync } = opts;
    _debugLog('[AsyncTask#waitForEvent()] args', { taskID: this.#id, waitableSetRep, isAsync });
    
    if (this.#isAsync !== isAsync) {
      throw new Error('async waitForEvent called on non-async task');
    }
    
    if (this.status === AsyncTask.State.CANCEL_PENDING) {
      this.#state = AsyncTask.State.CANCEL_DELIVERED;
      return {
        code: ASYNC_EVENT_CODE.TASK_CANCELLED,
      };
    }
    
    const state = getOrCreateAsyncState(this.#componentIdx);
    const waitableSet = state.waitableSets.get(waitableSetRep);
    if (!waitableSet) { throw new Error('missing/invalid waitable set'); }
    
    waitableSet.numWaiting += 1;
    let event = null;
    
    while (event == null) {
      const awaitable = new Awaitable(waitableSet.getPendingEvent());
      const waited = await this.blockOn({ awaitable, isAsync, isCancellable: true });
      if (waited) {
        if (this.#state !== AsyncTask.State.INITIAL) {
          throw new Error('task should be in initial state found [' + this.#state + ']');
        }
        this.#state = AsyncTask.State.CANCELLED;
        return {
          code: ASYNC_EVENT_CODE.TASK_CANCELLED,
        };
      }
      
      event = waitableSet.poll();
    }
    
    waitableSet.numWaiting -= 1;
    return event;
  }
  
  waitForEventSync(opts) {
    throw new Error('AsyncTask#yieldSync() not implemented')
  }
  
  async pollForEvent(opts) {
    const { waitableSetRep, isAsync } = opts;
    _debugLog('[AsyncTask#pollForEvent()] args', { taskID: this.#id, waitableSetRep, isAsync });
    
    if (this.#isAsync !== isAsync) {
      throw new Error('async pollForEvent called on non-async task');
    }
    
    throw new Error('AsyncTask#pollForEvent() not implemented');
  }
  
  pollForEventSync(opts) {
    throw new Error('AsyncTask#yieldSync() not implemented')
  }
  
  async blockOn(opts) {
    const { awaitable, isCancellable, forCallback } = opts;
    _debugLog('[AsyncTask#blockOn()] args', { taskID: this.#id, awaitable, isCancellable, forCallback });
    
    if (awaitable.resolved() && !ASYNC_DETERMINISM && _coinFlip()) {
      return AsyncTask.BlockResult.NOT_CANCELLED;
    }
    
    const cstate = getOrCreateAsyncState(this.#componentIdx);
    if (forCallback) { cstate.exclusiveRelease(); }
    
    let cancelled = await this.onBlock(awaitable);
    if (cancelled === AsyncTask.BlockResult.CANCELLED && !isCancellable) {
      const secondCancel = await this.onBlock(awaitable);
      if (secondCancel !== AsyncTask.BlockResult.NOT_CANCELLED) {
        throw new Error('uncancellable task was canceled despite second onBlock()');
      }
    }
    
    if (forCallback) {
      const acquired = new Awaitable(cstate.exclusiveLock());
      cancelled = await this.onBlock(acquired);
      if (cancelled === AsyncTask.BlockResult.CANCELLED) {
        const secondCancel = await this.onBlock(acquired);
        if (secondCancel !== AsyncTask.BlockResult.NOT_CANCELLED) {
          throw new Error('uncancellable callback task was canceled despite second onBlock()');
        }
      }
    }
    
    if (cancelled === AsyncTask.BlockResult.CANCELLED) {
      if (this.#state !== AsyncTask.State.INITIAL) {
        throw new Error('cancelled task is not at initial state');
      }
      if (isCancellable) {
        this.#state = AsyncTask.State.CANCELLED;
        return AsyncTask.BlockResult.CANCELLED;
      } else {
        this.#state = AsyncTask.State.CANCEL_PENDING;
        return AsyncTask.BlockResult.NOT_CANCELLED;
      }
    }
    
    return AsyncTask.BlockResult.NOT_CANCELLED;
  }
  
  async onBlock(awaitable) {
    _debugLog('[AsyncTask#onBlock()] args', { taskID: this.#id, awaitable });
    if (!(awaitable instanceof Awaitable)) {
      throw new Error('invalid awaitable during onBlock');
    }
    
    // Build a promise that this task can await on which resolves when it is awoken
    const { promise, resolve, reject } = Promise.withResolvers();
    this.awaitableResume = () => {
      _debugLog('[AsyncTask] resuming after onBlock', { taskID: this.#id });
      resolve();
    };
    this.awaitableCancel = (err) => {
      _debugLog('[AsyncTask] rejecting after onBlock', { taskID: this.#id, err });
      reject(err);
    };
    
    // Park this task/execution to be handled later
    const state = getOrCreateAsyncState(this.#componentIdx);
    state.parkTaskOnAwaitable({ awaitable, task: this });
    
    try {
      await promise;
      return AsyncTask.BlockResult.NOT_CANCELLED;
    } catch (err) {
      // rejection means task cancellation
      return AsyncTask.BlockResult.CANCELLED;
    }
  }
  
  async asyncOnBlock(awaitable) {
    _debugLog('[AsyncTask#asyncOnBlock()] args', { taskID: this.#id, awaitable });
    if (!(awaitable instanceof Awaitable)) {
      throw new Error('invalid awaitable during onBlock');
    }
    // TODO: watch for waitable AND cancellation
    // TODO: if it WAS cancelled:
    // - return true
    // - only once per subtask
    // - do not wait on the scheduler
    // - control flow should go to the subtask (only once)
    // - Once subtask blocks/resolves, reqlinquishControl() will tehn resolve request_cancel_end (without scheduler lock release)
    // - control flow goes back to request_cancel
    //
    // Subtask cancellation should work similarly to an async import call -- runs sync up until
    // the subtask blocks or resolves
    //
    throw new Error('AsyncTask#asyncOnBlock() not yet implemented');
  }
  
  async yield(opts) {
    const { isCancellable, forCallback } = opts;
    _debugLog('[AsyncTask#yield()] args', { taskID: this.#id, isCancellable, forCallback });
    
    if (isCancellable && this.status === AsyncTask.State.CANCEL_PENDING) {
      this.#state = AsyncTask.State.CANCELLED;
      return {
        code: ASYNC_EVENT_CODE.TASK_CANCELLED,
        payload: [0, 0],
      };
    }
    
    // TODO: Awaitables need to *always* trigger the parking mechanism when they're done...?
    // TODO: Component async state should remember which awaitables are done and work to clear tasks waiting
    
    const blockResult = await this.blockOn({
      awaitable: new Awaitable(new Promise(resolve => setTimeout(resolve, 0))),
      isCancellable,
      forCallback,
    });
    
    if (blockResult === AsyncTask.BlockResult.CANCELLED) {
      if (this.#state !== AsyncTask.State.INITIAL) {
        throw new Error('task should be in initial state found [' + this.#state + ']');
      }
      this.#state = AsyncTask.State.CANCELLED;
      return {
        code: ASYNC_EVENT_CODE.TASK_CANCELLED,
        payload: [0, 0],
      };
    }
    
    return {
      code: ASYNC_EVENT_CODE.NONE,
      payload: [0, 0],
    };
  }
  
  yieldSync(opts) {
    throw new Error('AsyncTask#yieldSync() not implemented')
  }
  
  cancel() {
    _debugLog('[AsyncTask#cancel()] args', { });
    if (!this.taskState() !== AsyncTask.State.CANCEL_DELIVERED) {
      throw new Error('invalid task state for cancellation');
    }
    if (this.borrowedHandles.length > 0) { throw new Error('task still has borrow handles'); }
    
    this.#onResolve(new Error('cancelled'));
    this.#state = AsyncTask.State.RESOLVED;
  }
  
  resolve(results) {
    _debugLog('[AsyncTask#resolve()] args', { results });
    if (this.#state === AsyncTask.State.RESOLVED) {
      throw new Error('task is already resolved');
    }
    if (this.borrowedHandles.length > 0) { throw new Error('task still has borrow handles'); }
    this.#onResolve(results.length === 1 ? results[0] : results);
    this.#state = AsyncTask.State.RESOLVED;
  }
  
  exit() {
    _debugLog('[AsyncTask#exit()] args', { });
    
    // TODO: ensure there is only one task at a time (scheduler.lock() functionality)
    if (this.#state !== AsyncTask.State.RESOLVED) {
      throw new Error('task exited without resolution');
    }
    if (this.borrowedHandles > 0) {
      throw new Error('task exited without clearing borrowed handles');
    }
    
    const state = getOrCreateAsyncState(this.#componentIdx);
    if (!state) { throw new Error('missing async state for component [' + this.#componentIdx + ']'); }
    if (!this.#isAsync && !state.inSyncExportCall) {
      throw new Error('sync task must be run from components known to be in a sync export call');
    }
    state.inSyncExportCall = false;
    
    this.startPendingTask();
  }
  
  startPendingTask(args) {
    _debugLog('[AsyncTask#startPendingTask()] args', args);
    throw new Error('AsyncTask#startPendingTask() not implemented');
  }
  
  createSubtask(args) {
    _debugLog('[AsyncTask#createSubtask()] args', args);
    const newSubtask = new AsyncSubtask({
      componentIdx: this.componentIdx(),
      taskID: this.id(),
      memoryIdx: args?.memoryIdx,
    });
    this.#subtasks.push(newSubtask);
    return newSubtask;
  }
  
  currentSubtask() {
    _debugLog('[AsyncTask#currentSubtask()]');
    if (this.#subtasks.length === 0) { throw new Error('no current subtask'); }
    return this.#subtasks.at(-1);
  }
  
  endCurrentSubtask() {
    _debugLog('[AsyncTask#endCurrentSubtask()]');
    if (this.#subtasks.length === 0) { throw new Error('cannot end current subtask: no current subtask'); }
    const subtask = this.#subtasks.pop();
    subtask.drop();
    return subtask;
  }
}

function unpackCallbackResult(result) {
  _debugLog('[unpackCallbackResult()] args', { result });
  if (!(_typeCheckValidI32(result))) { throw new Error('invalid callback return value [' + result + '], not a valid i32'); }
  const eventCode = result & 0xF;
  if (eventCode < 0 || eventCode > 3) {
    throw new Error('invalid async return value [' + eventCode + '], outside callback code range');
  }
  if (result < 0 || result >= 2**32) { throw new Error('invalid callback result'); }
  // TODO: table max length check?
  const waitableSetIdx = result >> 4;
  return [eventCode, waitableSetIdx];
}
const ASYNC_STATE = new Map();

function getOrCreateAsyncState(componentIdx, init) {
  if (!ASYNC_STATE.has(componentIdx)) {
    ASYNC_STATE.set(componentIdx, new ComponentAsyncState());
  }
  return ASYNC_STATE.get(componentIdx);
}

class ComponentAsyncState {
  #callingAsyncImport = false;
  #syncImportWait = Promise.withResolvers();
  #lock = null;
  
  mayLeave = true;
  waitableSets = new RepTable();
  waitables = new RepTable();
  
  #parkedTasks = new Map();
  
  callingSyncImport(val) {
    if (val === undefined) { return this.#callingAsyncImport; }
    if (typeof val !== 'boolean') { throw new TypeError('invalid setting for async import'); }
    const prev = this.#callingAsyncImport;
    this.#callingAsyncImport = val;
    if (prev === true && this.#callingAsyncImport === false) {
      this.#notifySyncImportEnd();
    }
  }
  
  #notifySyncImportEnd() {
    const existing = this.#syncImportWait;
    this.#syncImportWait = Promise.withResolvers();
    existing.resolve();
  }
  
  async waitForSyncImportCallEnd() {
    await this.#syncImportWait.promise;
  }
  
  parkTaskOnAwaitable(args) {
    if (!args.awaitable) { throw new TypeError('missing awaitable when trying to park'); }
    if (!args.task) { throw new TypeError('missing task when trying to park'); }
    const { awaitable, task } = args;
    
    let taskList = this.#parkedTasks.get(awaitable.id());
    if (!taskList) {
      taskList = [];
      this.#parkedTasks.set(awaitable.id(), taskList);
    }
    taskList.push(task);
    
    this.wakeNextTaskForAwaitable(awaitable);
  }
  
  wakeNextTaskForAwaitable(awaitable) {
    if (!awaitable) { throw new TypeError('missing awaitable when waking next task'); }
    const awaitableID = awaitable.id();
    
    const taskList = this.#parkedTasks.get(awaitableID);
    if (!taskList || taskList.length === 0) {
      _debugLog('[ComponentAsyncState] no tasks waiting for awaitable', { awaitableID: awaitable.id() });
      return;
    }
    
    let task = taskList.shift(); // todo(perf)
    if (!task) { throw new Error('no task in parked list despite previous check'); }
    
    if (!task.awaitableResume) {
      throw new Error('task ready due to awaitable is missing resume', { taskID: task.id(), awaitableID });
    }
    task.awaitableResume();
  }
  
  async exclusiveLock() {  // TODO: use atomics
  if (this.#lock === null) {
    this.#lock = { ticket: 0n };
  }
  
  // Take a ticket for the next valid usage
  const ticket = ++this.#lock.ticket;
  
  _debugLog('[ComponentAsyncState#exclusiveLock()] locking', {
    currentTicket: ticket - 1n,
    ticket
  });
  
  // If there is an active promise, then wait for it
  let finishedTicket;
  while (this.#lock.promise) {
    finishedTicket = await this.#lock.promise;
    if (finishedTicket === ticket - 1n) { break; }
  }
  
  const { promise, resolve } = Promise.withResolvers();
  this.#lock = {
    ticket,
    promise,
    resolve,
  };
  
  return this.#lock.promise;
}

exclusiveRelease() {
  _debugLog('[ComponentAsyncState#exclusiveRelease()] releasing', {
    currentTicket: this.#lock === null ? 'none' : this.#lock.ticket,
  });
  
  if (this.#lock === null) { return; }
  
  const existingLock = this.#lock;
  this.#lock = null;
  existingLock.resolve(existingLock.ticket);
}

isExclusivelyLocked() { return this.#lock !== null; }

}

function prepareCall(memoryIdx) {
  _debugLog('[prepareCall()] args', { memoryIdx });
  
  const taskMeta = getCurrentTask(ASYNC_CURRENT_COMPONENT_IDXS.at(-1), ASYNC_CURRENT_TASK_IDS.at(-1));
  if (!taskMeta) { throw new Error('invalid/missing current async task meta during prepare call'); }
  
  const task = taskMeta.task;
  if (!task) { throw new Error('unexpectedly missing task in task meta during prepare call'); }
  
  const state = getOrCreateAsyncState(task.componentIdx());
  if (!state) {
    throw new Error('invalid/missing async state for component instance [' + componentInstanceID + ']');
  }
  
  const subtask = task.createSubtask({
    memoryIdx,
  });
  
}

function asyncStartCall(callbackIdx, postReturnIdx) {
  _debugLog('[asyncStartCall()] args', { callbackIdx, postReturnIdx });
  
  const taskMeta = getCurrentTask(ASYNC_CURRENT_COMPONENT_IDXS.at(-1), ASYNC_CURRENT_TASK_IDS.at(-1));
  if (!taskMeta) { throw new Error('invalid/missing current async task meta during prepare call'); }
  
  const task = taskMeta.task;
  if (!task) { throw new Error('unexpectedly missing task in task meta during prepare call'); }
  
  const subtask = task.currentSubtask();
  if (!subtask) { throw new Error('invalid/missing subtask during async start call'); }
  
  return Number(subtask.waitableRep()) << 4 | subtask.getStateNumber();
}

function syncStartCall(callbackIdx) {
  _debugLog('[syncStartCall()] args', { callbackIdx });
}

if (!Promise.withResolvers) {
  Promise.withResolvers = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

const _debugLog = (...args) => {
  if (!globalThis?.process?.env?.JCO_DEBUG) { return; }
  console.debug(...args);
}
const ASYNC_DETERMINISM = 'random';
const _coinFlip = () => { return Math.random() > 0.5; };
const I32_MAX = 2_147_483_647;
const I32_MIN = -2_147_483_648;
const _typeCheckValidI32 = (n) => typeof n === 'number' && n >= I32_MIN && n <= I32_MAX;

const base64Compile = str => WebAssembly.compile(Uint8Array.from(atob(str), b => b.charCodeAt(0)));

const fetchCompile = url => fetch(url).then(WebAssembly.compileStreaming);

const symbolCabiDispose = Symbol.for('cabiDispose');

const symbolRscHandle = Symbol('handle');

const symbolRscRep = Symbol.for('cabiRep');

const symbolDispose = Symbol.dispose || Symbol.for('dispose');

const handleTables = [];

class ComponentError extends Error {
  constructor (value) {
    const enumerable = typeof value !== 'string';
    super(enumerable ? `${String(value)} (see error.payload)` : value);
    Object.defineProperty(this, 'payload', { value, enumerable });
  }
}

function getErrorPayload(e) {
  if (e && hasOwnProperty.call(e, 'payload')) return e.payload;
  if (e instanceof Error) throw e;
  return e;
}

class RepTable {
  #data = [0, null];
  
  insert(val) {
    _debugLog('[RepTable#insert()] args', { val });
    const freeIdx = this.#data[0];
    if (freeIdx === 0) {
      this.#data.push(val);
      this.#data.push(null);
      return (this.#data.length >> 1) - 1;
    }
    this.#data[0] = this.#data[freeIdx << 1];
    const placementIdx = freeIdx << 1;
    this.#data[placementIdx] = val;
    this.#data[placementIdx + 1] = null;
    return freeIdx;
  }
  
  get(rep) {
    _debugLog('[RepTable#get()] args', { rep });
    const baseIdx = rep << 1;
    const val = this.#data[baseIdx];
    return val;
  }
  
  contains(rep) {
    _debugLog('[RepTable#contains()] args', { rep });
    const baseIdx = rep << 1;
    return !!this.#data[baseIdx];
  }
  
  remove(rep) {
    _debugLog('[RepTable#remove()] args', { rep });
    if (this.#data.length === 2) { throw new Error('invalid'); }
    
    const baseIdx = rep << 1;
    const val = this.#data[baseIdx];
    if (val === 0) { throw new Error('invalid resource rep (cannot be 0)'); }
    
    this.#data[baseIdx] = this.#data[0];
    this.#data[0] = rep;
    
    return val;
  }
  
  clear() {
    _debugLog('[RepTable#clear()] args', { rep });
    this.#data = [0, null];
  }
}

function throwInvalidBool() {
  throw new TypeError('invalid variant discriminant for bool');
}

const hasOwnProperty = Object.prototype.hasOwnProperty;

const instantiateCore = WebAssembly.instantiate;


let exports0;
const handleTable3 = [T_FLAG, 0];
const captureTable3= new Map();
let captureCnt3 = 0;
handleTables[3] = handleTable3;

function trampoline0(arg0) {
  var handle1 = arg0;
  var rep2 = handleTable3[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable3.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Gpu.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu.get-preferred-canvas-format"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]gpu.get-preferred-canvas-format');
  const ret = rsc0.getPreferredCanvasFormat();
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu.get-preferred-canvas-format"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  var val3 = ret;
  let enum3;
  switch (val3) {
    case 'r8unorm': {
      enum3 = 0;
      break;
    }
    case 'r8snorm': {
      enum3 = 1;
      break;
    }
    case 'r8uint': {
      enum3 = 2;
      break;
    }
    case 'r8sint': {
      enum3 = 3;
      break;
    }
    case 'r16uint': {
      enum3 = 4;
      break;
    }
    case 'r16sint': {
      enum3 = 5;
      break;
    }
    case 'r16float': {
      enum3 = 6;
      break;
    }
    case 'rg8unorm': {
      enum3 = 7;
      break;
    }
    case 'rg8snorm': {
      enum3 = 8;
      break;
    }
    case 'rg8uint': {
      enum3 = 9;
      break;
    }
    case 'rg8sint': {
      enum3 = 10;
      break;
    }
    case 'r32uint': {
      enum3 = 11;
      break;
    }
    case 'r32sint': {
      enum3 = 12;
      break;
    }
    case 'r32float': {
      enum3 = 13;
      break;
    }
    case 'rg16uint': {
      enum3 = 14;
      break;
    }
    case 'rg16sint': {
      enum3 = 15;
      break;
    }
    case 'rg16float': {
      enum3 = 16;
      break;
    }
    case 'rgba8unorm': {
      enum3 = 17;
      break;
    }
    case 'rgba8unorm-srgb': {
      enum3 = 18;
      break;
    }
    case 'rgba8snorm': {
      enum3 = 19;
      break;
    }
    case 'rgba8uint': {
      enum3 = 20;
      break;
    }
    case 'rgba8sint': {
      enum3 = 21;
      break;
    }
    case 'bgra8unorm': {
      enum3 = 22;
      break;
    }
    case 'bgra8unorm-srgb': {
      enum3 = 23;
      break;
    }
    case 'rgb9e5ufloat': {
      enum3 = 24;
      break;
    }
    case 'rgb10a2uint': {
      enum3 = 25;
      break;
    }
    case 'rgb10a2unorm': {
      enum3 = 26;
      break;
    }
    case 'rg11b10ufloat': {
      enum3 = 27;
      break;
    }
    case 'rg32uint': {
      enum3 = 28;
      break;
    }
    case 'rg32sint': {
      enum3 = 29;
      break;
    }
    case 'rg32float': {
      enum3 = 30;
      break;
    }
    case 'rgba16uint': {
      enum3 = 31;
      break;
    }
    case 'rgba16sint': {
      enum3 = 32;
      break;
    }
    case 'rgba16float': {
      enum3 = 33;
      break;
    }
    case 'rgba32uint': {
      enum3 = 34;
      break;
    }
    case 'rgba32sint': {
      enum3 = 35;
      break;
    }
    case 'rgba32float': {
      enum3 = 36;
      break;
    }
    case 'stencil8': {
      enum3 = 37;
      break;
    }
    case 'depth16unorm': {
      enum3 = 38;
      break;
    }
    case 'depth24plus': {
      enum3 = 39;
      break;
    }
    case 'depth24plus-stencil8': {
      enum3 = 40;
      break;
    }
    case 'depth32float': {
      enum3 = 41;
      break;
    }
    case 'depth32float-stencil8': {
      enum3 = 42;
      break;
    }
    case 'bc1-rgba-unorm': {
      enum3 = 43;
      break;
    }
    case 'bc1-rgba-unorm-srgb': {
      enum3 = 44;
      break;
    }
    case 'bc2-rgba-unorm': {
      enum3 = 45;
      break;
    }
    case 'bc2-rgba-unorm-srgb': {
      enum3 = 46;
      break;
    }
    case 'bc3-rgba-unorm': {
      enum3 = 47;
      break;
    }
    case 'bc3-rgba-unorm-srgb': {
      enum3 = 48;
      break;
    }
    case 'bc4-r-unorm': {
      enum3 = 49;
      break;
    }
    case 'bc4-r-snorm': {
      enum3 = 50;
      break;
    }
    case 'bc5-rg-unorm': {
      enum3 = 51;
      break;
    }
    case 'bc5-rg-snorm': {
      enum3 = 52;
      break;
    }
    case 'bc6h-rgb-ufloat': {
      enum3 = 53;
      break;
    }
    case 'bc6h-rgb-float': {
      enum3 = 54;
      break;
    }
    case 'bc7-rgba-unorm': {
      enum3 = 55;
      break;
    }
    case 'bc7-rgba-unorm-srgb': {
      enum3 = 56;
      break;
    }
    case 'etc2-rgb8unorm': {
      enum3 = 57;
      break;
    }
    case 'etc2-rgb8unorm-srgb': {
      enum3 = 58;
      break;
    }
    case 'etc2-rgb8a1unorm': {
      enum3 = 59;
      break;
    }
    case 'etc2-rgb8a1unorm-srgb': {
      enum3 = 60;
      break;
    }
    case 'etc2-rgba8unorm': {
      enum3 = 61;
      break;
    }
    case 'etc2-rgba8unorm-srgb': {
      enum3 = 62;
      break;
    }
    case 'eac-r11unorm': {
      enum3 = 63;
      break;
    }
    case 'eac-r11snorm': {
      enum3 = 64;
      break;
    }
    case 'eac-rg11unorm': {
      enum3 = 65;
      break;
    }
    case 'eac-rg11snorm': {
      enum3 = 66;
      break;
    }
    case 'astc4x4-unorm': {
      enum3 = 67;
      break;
    }
    case 'astc4x4-unorm-srgb': {
      enum3 = 68;
      break;
    }
    case 'astc5x4-unorm': {
      enum3 = 69;
      break;
    }
    case 'astc5x4-unorm-srgb': {
      enum3 = 70;
      break;
    }
    case 'astc5x5-unorm': {
      enum3 = 71;
      break;
    }
    case 'astc5x5-unorm-srgb': {
      enum3 = 72;
      break;
    }
    case 'astc6x5-unorm': {
      enum3 = 73;
      break;
    }
    case 'astc6x5-unorm-srgb': {
      enum3 = 74;
      break;
    }
    case 'astc6x6-unorm': {
      enum3 = 75;
      break;
    }
    case 'astc6x6-unorm-srgb': {
      enum3 = 76;
      break;
    }
    case 'astc8x5-unorm': {
      enum3 = 77;
      break;
    }
    case 'astc8x5-unorm-srgb': {
      enum3 = 78;
      break;
    }
    case 'astc8x6-unorm': {
      enum3 = 79;
      break;
    }
    case 'astc8x6-unorm-srgb': {
      enum3 = 80;
      break;
    }
    case 'astc8x8-unorm': {
      enum3 = 81;
      break;
    }
    case 'astc8x8-unorm-srgb': {
      enum3 = 82;
      break;
    }
    case 'astc10x5-unorm': {
      enum3 = 83;
      break;
    }
    case 'astc10x5-unorm-srgb': {
      enum3 = 84;
      break;
    }
    case 'astc10x6-unorm': {
      enum3 = 85;
      break;
    }
    case 'astc10x6-unorm-srgb': {
      enum3 = 86;
      break;
    }
    case 'astc10x8-unorm': {
      enum3 = 87;
      break;
    }
    case 'astc10x8-unorm-srgb': {
      enum3 = 88;
      break;
    }
    case 'astc10x10-unorm': {
      enum3 = 89;
      break;
    }
    case 'astc10x10-unorm-srgb': {
      enum3 = 90;
      break;
    }
    case 'astc12x10-unorm': {
      enum3 = 91;
      break;
    }
    case 'astc12x10-unorm-srgb': {
      enum3 = 92;
      break;
    }
    case 'astc12x12-unorm': {
      enum3 = 93;
      break;
    }
    case 'astc12x12-unorm-srgb': {
      enum3 = 94;
      break;
    }
    default: {
      if ((ret) instanceof Error) {
        console.error(ret);
      }
      
      throw new TypeError(`"${val3}" is not one of the cases of gpu-texture-format`);
    }
  }
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu.get-preferred-canvas-format"][Instruction::Return]', {
    funcName: '[method]gpu.get-preferred-canvas-format',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  return enum3;
}

const handleTable6 = [T_FLAG, 0];
const captureTable6= new Map();
let captureCnt6 = 0;
handleTables[6] = handleTable6;
const handleTable7 = [T_FLAG, 0];
const captureTable7= new Map();
let captureCnt7 = 0;
handleTables[7] = handleTable7;

function trampoline2(arg0) {
  var handle1 = arg0;
  var rep2 = handleTable6[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable6.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(GpuDevice.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-device.queue"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]gpu-device.queue');
  const ret = rsc0.queue();
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-device.queue"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  if (!(ret instanceof GpuQueue)) {
    throw new TypeError('Resource error: Not a valid "GpuQueue" resource.');
  }
  var handle3 = ret[symbolRscHandle];
  if (!handle3) {
    const rep = ret[symbolRscRep] || ++captureCnt7;
    captureTable7.set(rep, ret);
    handle3 = rscTableCreateOwn(handleTable7, rep);
  }
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-device.queue"][Instruction::Return]', {
    funcName: '[method]gpu-device.queue',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  return handle3;
}

const handleTable1 = [T_FLAG, 0];
const captureTable1= new Map();
let captureCnt1 = 0;
handleTables[1] = handleTable1;

function trampoline4(arg0, arg1) {
  var handle1 = arg0;
  var rep2 = handleTable6[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable6.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(GpuDevice.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  var handle4 = arg1;
  var rep5 = handleTable1[(handle4 << 1) + 1] & ~T_FLAG;
  var rsc3 = captureTable1.get(rep5);
  if (!rsc3) {
    rsc3 = Object.create(Context.prototype);
    Object.defineProperty(rsc3, symbolRscHandle, { writable: true, value: handle4});
    Object.defineProperty(rsc3, symbolRscRep, { writable: true, value: rep5});
  }
  curResourceBorrows.push(rsc3);
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-device.connect-graphics-context"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]gpu-device.connect-graphics-context');
  rsc0.connectGraphicsContext(rsc3);
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-device.connect-graphics-context"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-device.connect-graphics-context"][Instruction::Return]', {
    funcName: '[method]gpu-device.connect-graphics-context',
    paramCount: 0,
    async: false,
    postReturn: false
  });
}

const handleTable2 = [T_FLAG, 0];
const captureTable2= new Map();
let captureCnt2 = 0;
handleTables[2] = handleTable2;
const handleTable14 = [T_FLAG, 0];
const captureTable14= new Map();
let captureCnt14 = 0;
handleTables[14] = handleTable14;

function trampoline5(arg0) {
  var handle1 = arg0;
  var rep2 = handleTable2[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable2.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(AbstractBuffer.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  else {
    captureTable2.delete(rep2);
  }
  rscTableRemove(handleTable2, handle1);
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[static]gpu-texture.from-graphics-buffer"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[static]gpu-texture.from-graphics-buffer');
  const ret = GpuTexture.fromGraphicsBuffer(rsc0);
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[static]gpu-texture.from-graphics-buffer"] [Instruction::CallInterface] (sync, @ post-call)');
  endCurrentTask(0);
  if (!(ret instanceof GpuTexture)) {
    throw new TypeError('Resource error: Not a valid "GpuTexture" resource.');
  }
  var handle3 = ret[symbolRscHandle];
  if (!handle3) {
    const rep = ret[symbolRscRep] || ++captureCnt14;
    captureTable14.set(rep, ret);
    handle3 = rscTableCreateOwn(handleTable14, rep);
  }
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[static]gpu-texture.from-graphics-buffer"][Instruction::Return]', {
    funcName: '[static]gpu-texture.from-graphics-buffer',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  return handle3;
}

const handleTable17 = [T_FLAG, 0];
const captureTable17= new Map();
let captureCnt17 = 0;
handleTables[17] = handleTable17;

function trampoline7(arg0) {
  var handle1 = arg0;
  var rep2 = handleTable17[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable17.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(GpuRenderPassEncoder.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-render-pass-encoder.end"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]gpu-render-pass-encoder.end');
  rsc0.end();
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-render-pass-encoder.end"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-render-pass-encoder.end"][Instruction::Return]', {
    funcName: '[method]gpu-render-pass-encoder.end',
    paramCount: 0,
    async: false,
    postReturn: false
  });
}

const handleTable12 = [T_FLAG, 0];
const captureTable12= new Map();
let captureCnt12 = 0;
handleTables[12] = handleTable12;

function trampoline8(arg0, arg1) {
  var handle1 = arg0;
  var rep2 = handleTable17[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable17.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(GpuRenderPassEncoder.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  var handle4 = arg1;
  var rep5 = handleTable12[(handle4 << 1) + 1] & ~T_FLAG;
  var rsc3 = captureTable12.get(rep5);
  if (!rsc3) {
    rsc3 = Object.create(GpuRenderPipeline.prototype);
    Object.defineProperty(rsc3, symbolRscHandle, { writable: true, value: handle4});
    Object.defineProperty(rsc3, symbolRscRep, { writable: true, value: rep5});
  }
  curResourceBorrows.push(rsc3);
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-render-pass-encoder.set-pipeline"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]gpu-render-pass-encoder.set-pipeline');
  rsc0.setPipeline(rsc3);
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-render-pass-encoder.set-pipeline"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-render-pass-encoder.set-pipeline"][Instruction::Return]', {
    funcName: '[method]gpu-render-pass-encoder.set-pipeline',
    paramCount: 0,
    async: false,
    postReturn: false
  });
}


function trampoline9(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7) {
  var handle1 = arg0;
  var rep2 = handleTable17[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable17.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(GpuRenderPassEncoder.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  let variant3;
  switch (arg2) {
    case 0: {
      variant3 = undefined;
      break;
    }
    case 1: {
      variant3 = arg3 >>> 0;
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  let variant4;
  switch (arg4) {
    case 0: {
      variant4 = undefined;
      break;
    }
    case 1: {
      variant4 = arg5 >>> 0;
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  let variant5;
  switch (arg6) {
    case 0: {
      variant5 = undefined;
      break;
    }
    case 1: {
      variant5 = arg7 >>> 0;
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-render-pass-encoder.draw"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]gpu-render-pass-encoder.draw');
  rsc0.draw(arg1 >>> 0, variant3, variant4, variant5);
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-render-pass-encoder.draw"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-render-pass-encoder.draw"][Instruction::Return]', {
    funcName: '[method]gpu-render-pass-encoder.draw',
    paramCount: 0,
    async: false,
    postReturn: false
  });
}


function trampoline10() {
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="get-gpu"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, 'get-gpu');
  const ret = getGpu();
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="get-gpu"] [Instruction::CallInterface] (sync, @ post-call)');
  endCurrentTask(0);
  if (!(ret instanceof Gpu)) {
    throw new TypeError('Resource error: Not a valid "Gpu" resource.');
  }
  var handle0 = ret[symbolRscHandle];
  if (!handle0) {
    const rep = ret[symbolRscRep] || ++captureCnt3;
    captureTable3.set(rep, ret);
    handle0 = rscTableCreateOwn(handleTable3, rep);
  }
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="get-gpu"][Instruction::Return]', {
    funcName: 'get-gpu',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  return handle0;
}


function trampoline13() {
  _debugLog('[iface="wasi:graphics-context/graphics-context@0.0.1", function="[constructor]context"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[constructor]context');
  const ret = new Context();
  _debugLog('[iface="wasi:graphics-context/graphics-context@0.0.1", function="[constructor]context"] [Instruction::CallInterface] (sync, @ post-call)');
  endCurrentTask(0);
  if (!(ret instanceof Context)) {
    throw new TypeError('Resource error: Not a valid "Context" resource.');
  }
  var handle0 = ret[symbolRscHandle];
  if (!handle0) {
    const rep = ret[symbolRscRep] || ++captureCnt1;
    captureTable1.set(rep, ret);
    handle0 = rscTableCreateOwn(handleTable1, rep);
  }
  _debugLog('[iface="wasi:graphics-context/graphics-context@0.0.1", function="[constructor]context"][Instruction::Return]', {
    funcName: '[constructor]context',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  return handle0;
}


function trampoline14(arg0) {
  var handle1 = arg0;
  var rep2 = handleTable1[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable1.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Context.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:graphics-context/graphics-context@0.0.1", function="[method]context.get-current-buffer"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]context.get-current-buffer');
  const ret = rsc0.getCurrentBuffer();
  _debugLog('[iface="wasi:graphics-context/graphics-context@0.0.1", function="[method]context.get-current-buffer"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  if (!(ret instanceof AbstractBuffer)) {
    throw new TypeError('Resource error: Not a valid "AbstractBuffer" resource.');
  }
  var handle3 = ret[symbolRscHandle];
  if (!handle3) {
    const rep = ret[symbolRscRep] || ++captureCnt2;
    captureTable2.set(rep, ret);
    handle3 = rscTableCreateOwn(handleTable2, rep);
  }
  _debugLog('[iface="wasi:graphics-context/graphics-context@0.0.1", function="[method]context.get-current-buffer"][Instruction::Return]', {
    funcName: '[method]context.get-current-buffer',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  return handle3;
}


function trampoline15(arg0) {
  var handle1 = arg0;
  var rep2 = handleTable1[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable1.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Context.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:graphics-context/graphics-context@0.0.1", function="[method]context.present"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]context.present');
  rsc0.present();
  _debugLog('[iface="wasi:graphics-context/graphics-context@0.0.1", function="[method]context.present"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  _debugLog('[iface="wasi:graphics-context/graphics-context@0.0.1", function="[method]context.present"][Instruction::Return]', {
    funcName: '[method]context.present',
    paramCount: 0,
    async: false,
    postReturn: false
  });
}

const handleTable19 = [T_FLAG, 0];
const captureTable19= new Map();
let captureCnt19 = 0;
handleTables[19] = handleTable19;

function trampoline25(arg0, arg1, arg2, arg3) {
  let variant0;
  switch (arg0) {
    case 0: {
      variant0 = undefined;
      break;
    }
    case 1: {
      variant0 = arg1 >>> 0;
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  let variant1;
  switch (arg2) {
    case 0: {
      variant1 = undefined;
      break;
    }
    case 1: {
      variant1 = arg3 >>> 0;
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[constructor]surface"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[constructor]surface');
  const ret = new Surface({
    height: variant0,
    width: variant1,
  });
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[constructor]surface"] [Instruction::CallInterface] (sync, @ post-call)');
  endCurrentTask(0);
  if (!(ret instanceof Surface)) {
    throw new TypeError('Resource error: Not a valid "Surface" resource.');
  }
  var handle2 = ret[symbolRscHandle];
  if (!handle2) {
    const rep = ret[symbolRscRep] || ++captureCnt19;
    captureTable19.set(rep, ret);
    handle2 = rscTableCreateOwn(handleTable19, rep);
  }
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[constructor]surface"][Instruction::Return]', {
    funcName: '[constructor]surface',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  return handle2;
}


function trampoline26(arg0, arg1) {
  var handle1 = arg0;
  var rep2 = handleTable19[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable19.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Surface.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  var handle4 = arg1;
  var rep5 = handleTable1[(handle4 << 1) + 1] & ~T_FLAG;
  var rsc3 = captureTable1.get(rep5);
  if (!rsc3) {
    rsc3 = Object.create(Context.prototype);
    Object.defineProperty(rsc3, symbolRscHandle, { writable: true, value: handle4});
    Object.defineProperty(rsc3, symbolRscRep, { writable: true, value: rep5});
  }
  curResourceBorrows.push(rsc3);
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.connect-graphics-context"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]surface.connect-graphics-context');
  rsc0.connectGraphicsContext(rsc3);
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.connect-graphics-context"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.connect-graphics-context"][Instruction::Return]', {
    funcName: '[method]surface.connect-graphics-context',
    paramCount: 0,
    async: false,
    postReturn: false
  });
}

const handleTable0 = [T_FLAG, 0];
const captureTable0= new Map();
let captureCnt0 = 0;
handleTables[0] = handleTable0;

function trampoline27(arg0) {
  var handle1 = arg0;
  var rep2 = handleTable19[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable19.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Surface.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.subscribe-pointer-up"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]surface.subscribe-pointer-up');
  const ret = rsc0.subscribePointerUp();
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.subscribe-pointer-up"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  if (!(ret instanceof Pollable)) {
    throw new TypeError('Resource error: Not a valid "Pollable" resource.');
  }
  var handle3 = ret[symbolRscHandle];
  if (!handle3) {
    const rep = ret[symbolRscRep] || ++captureCnt0;
    captureTable0.set(rep, ret);
    handle3 = rscTableCreateOwn(handleTable0, rep);
  }
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.subscribe-pointer-up"][Instruction::Return]', {
    funcName: '[method]surface.subscribe-pointer-up',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  return handle3;
}


function trampoline28(arg0) {
  var handle1 = arg0;
  var rep2 = handleTable19[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable19.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Surface.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.subscribe-pointer-down"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]surface.subscribe-pointer-down');
  const ret = rsc0.subscribePointerDown();
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.subscribe-pointer-down"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  if (!(ret instanceof Pollable)) {
    throw new TypeError('Resource error: Not a valid "Pollable" resource.');
  }
  var handle3 = ret[symbolRscHandle];
  if (!handle3) {
    const rep = ret[symbolRscRep] || ++captureCnt0;
    captureTable0.set(rep, ret);
    handle3 = rscTableCreateOwn(handleTable0, rep);
  }
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.subscribe-pointer-down"][Instruction::Return]', {
    funcName: '[method]surface.subscribe-pointer-down',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  return handle3;
}


function trampoline29(arg0) {
  var handle1 = arg0;
  var rep2 = handleTable19[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable19.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Surface.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.subscribe-pointer-move"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]surface.subscribe-pointer-move');
  const ret = rsc0.subscribePointerMove();
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.subscribe-pointer-move"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  if (!(ret instanceof Pollable)) {
    throw new TypeError('Resource error: Not a valid "Pollable" resource.');
  }
  var handle3 = ret[symbolRscHandle];
  if (!handle3) {
    const rep = ret[symbolRscRep] || ++captureCnt0;
    captureTable0.set(rep, ret);
    handle3 = rscTableCreateOwn(handleTable0, rep);
  }
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.subscribe-pointer-move"][Instruction::Return]', {
    funcName: '[method]surface.subscribe-pointer-move',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  return handle3;
}


function trampoline30(arg0) {
  var handle1 = arg0;
  var rep2 = handleTable19[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable19.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Surface.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.subscribe-key-up"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]surface.subscribe-key-up');
  const ret = rsc0.subscribeKeyUp();
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.subscribe-key-up"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  if (!(ret instanceof Pollable)) {
    throw new TypeError('Resource error: Not a valid "Pollable" resource.');
  }
  var handle3 = ret[symbolRscHandle];
  if (!handle3) {
    const rep = ret[symbolRscRep] || ++captureCnt0;
    captureTable0.set(rep, ret);
    handle3 = rscTableCreateOwn(handleTable0, rep);
  }
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.subscribe-key-up"][Instruction::Return]', {
    funcName: '[method]surface.subscribe-key-up',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  return handle3;
}


function trampoline31(arg0) {
  var handle1 = arg0;
  var rep2 = handleTable19[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable19.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Surface.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.subscribe-key-down"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]surface.subscribe-key-down');
  const ret = rsc0.subscribeKeyDown();
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.subscribe-key-down"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  if (!(ret instanceof Pollable)) {
    throw new TypeError('Resource error: Not a valid "Pollable" resource.');
  }
  var handle3 = ret[symbolRscHandle];
  if (!handle3) {
    const rep = ret[symbolRscRep] || ++captureCnt0;
    captureTable0.set(rep, ret);
    handle3 = rscTableCreateOwn(handleTable0, rep);
  }
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.subscribe-key-down"][Instruction::Return]', {
    funcName: '[method]surface.subscribe-key-down',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  return handle3;
}


function trampoline32(arg0) {
  var handle1 = arg0;
  var rep2 = handleTable19[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable19.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Surface.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.subscribe-resize"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]surface.subscribe-resize');
  const ret = rsc0.subscribeResize();
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.subscribe-resize"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  if (!(ret instanceof Pollable)) {
    throw new TypeError('Resource error: Not a valid "Pollable" resource.');
  }
  var handle3 = ret[symbolRscHandle];
  if (!handle3) {
    const rep = ret[symbolRscRep] || ++captureCnt0;
    captureTable0.set(rep, ret);
    handle3 = rscTableCreateOwn(handleTable0, rep);
  }
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.subscribe-resize"][Instruction::Return]', {
    funcName: '[method]surface.subscribe-resize',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  return handle3;
}


function trampoline33(arg0) {
  var handle1 = arg0;
  var rep2 = handleTable19[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable19.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Surface.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.subscribe-frame"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]surface.subscribe-frame');
  const ret = rsc0.subscribeFrame();
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.subscribe-frame"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  if (!(ret instanceof Pollable)) {
    throw new TypeError('Resource error: Not a valid "Pollable" resource.');
  }
  var handle3 = ret[symbolRscHandle];
  if (!handle3) {
    const rep = ret[symbolRscRep] || ++captureCnt0;
    captureTable0.set(rep, ret);
    handle3 = rscTableCreateOwn(handleTable0, rep);
  }
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.subscribe-frame"][Instruction::Return]', {
    funcName: '[method]surface.subscribe-frame',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  return handle3;
}

const handleTable21 = [T_FLAG, 0];
const captureTable21= new Map();
let captureCnt21 = 0;
handleTables[21] = handleTable21;

function trampoline34() {
  _debugLog('[iface="wasi:cli/stdout@0.2.0", function="get-stdout"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, 'get-stdout');
  const ret = getStdout();
  _debugLog('[iface="wasi:cli/stdout@0.2.0", function="get-stdout"] [Instruction::CallInterface] (sync, @ post-call)');
  endCurrentTask(0);
  if (!(ret instanceof OutputStream)) {
    throw new TypeError('Resource error: Not a valid "OutputStream" resource.');
  }
  var handle0 = ret[symbolRscHandle];
  if (!handle0) {
    const rep = ret[symbolRscRep] || ++captureCnt21;
    captureTable21.set(rep, ret);
    handle0 = rscTableCreateOwn(handleTable21, rep);
  }
  _debugLog('[iface="wasi:cli/stdout@0.2.0", function="get-stdout"][Instruction::Return]', {
    funcName: 'get-stdout',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  return handle0;
}

let exports1;
let memory0;
let realloc0;
const handleTable4 = [T_FLAG, 0];
const captureTable4= new Map();
let captureCnt4 = 0;
handleTables[4] = handleTable4;

const trampoline35 = new WebAssembly.Suspending(async function(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9, arg10, arg11) {
  var handle1 = arg0;
  var rep2 = handleTable3[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable3.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Gpu.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  let variant11;
  switch (arg1) {
    case 0: {
      variant11 = undefined;
      break;
    }
    case 1: {
      let variant4;
      switch (arg2) {
        case 0: {
          variant4 = undefined;
          break;
        }
        case 1: {
          var ptr3 = arg3;
          var len3 = arg4;
          var result3 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr3, len3));
          variant4 = result3;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant6;
      switch (arg5) {
        case 0: {
          variant6 = undefined;
          break;
        }
        case 1: {
          let enum5;
          switch (arg6) {
            case 0: {
              enum5 = 'low-power';
              break;
            }
            case 1: {
              enum5 = 'high-performance';
              break;
            }
            default: {
              throw new TypeError('invalid discriminant specified for GpuPowerPreference');
            }
          }
          variant6 = enum5;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant8;
      switch (arg7) {
        case 0: {
          variant8 = undefined;
          break;
        }
        case 1: {
          var bool7 = arg8;
          variant8 = bool7 == 0 ? false : (bool7 == 1 ? true : throwInvalidBool());
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant10;
      switch (arg9) {
        case 0: {
          variant10 = undefined;
          break;
        }
        case 1: {
          var bool9 = arg10;
          variant10 = bool9 == 0 ? false : (bool9 == 1 ? true : throwInvalidBool());
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      variant11 = {
        featureLevel: variant4,
        powerPreference: variant6,
        forceFallbackAdapter: variant8,
        xrCompatible: variant10,
      };
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu.request-adapter"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]gpu.request-adapter');
  const ret = await rsc0.requestAdapter(variant11);
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu.request-adapter"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  var variant13 = ret;
  if (variant13 === null || variant13=== undefined) {
    dataView(memory0).setInt8(arg11 + 0, 0, true);
  } else {
    const e = variant13;
    dataView(memory0).setInt8(arg11 + 0, 1, true);
    if (!(e instanceof GpuAdapter)) {
      throw new TypeError('Resource error: Not a valid "GpuAdapter" resource.');
    }
    var handle12 = e[symbolRscHandle];
    if (!handle12) {
      const rep = e[symbolRscRep] || ++captureCnt4;
      captureTable4.set(rep, e);
      handle12 = rscTableCreateOwn(handleTable4, rep);
    }
    dataView(memory0).setInt32(arg11 + 4, handle12, true);
  }
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu.request-adapter"][Instruction::Return]', {
    funcName: '[method]gpu.request-adapter',
    paramCount: 0,
    async: false,
    postReturn: false
  });
}
);
const handleTable5 = [T_FLAG, 0];
const captureTable5= new Map();
let captureCnt5 = 0;
handleTables[5] = handleTable5;

const trampoline36 = new WebAssembly.Suspending(async function(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9, arg10, arg11, arg12, arg13, arg14) {
  var handle1 = arg0;
  var rep2 = handleTable4[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable4.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(GpuAdapter.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  let variant15;
  switch (arg1) {
    case 0: {
      variant15 = undefined;
      break;
    }
    case 1: {
      let variant5;
      switch (arg2) {
        case 0: {
          variant5 = undefined;
          break;
        }
        case 1: {
          var len4 = arg4;
          var base4 = arg3;
          var result4 = [];
          for (let i = 0; i < len4; i++) {
            const base = base4 + i * 1;
            let enum3;
            switch (dataView(memory0).getUint8(base + 0, true)) {
              case 0: {
                enum3 = 'depth-clip-control';
                break;
              }
              case 1: {
                enum3 = 'depth32float-stencil8';
                break;
              }
              case 2: {
                enum3 = 'texture-compression-bc';
                break;
              }
              case 3: {
                enum3 = 'texture-compression-bc-sliced3d';
                break;
              }
              case 4: {
                enum3 = 'texture-compression-etc2';
                break;
              }
              case 5: {
                enum3 = 'texture-compression-astc';
                break;
              }
              case 6: {
                enum3 = 'texture-compression-astc-sliced3d';
                break;
              }
              case 7: {
                enum3 = 'timestamp-query';
                break;
              }
              case 8: {
                enum3 = 'indirect-first-instance';
                break;
              }
              case 9: {
                enum3 = 'shader-f16';
                break;
              }
              case 10: {
                enum3 = 'rg11b10ufloat-renderable';
                break;
              }
              case 11: {
                enum3 = 'bgra8unorm-storage';
                break;
              }
              case 12: {
                enum3 = 'float32-filterable';
                break;
              }
              case 13: {
                enum3 = 'float32-blendable';
                break;
              }
              case 14: {
                enum3 = 'clip-distances';
                break;
              }
              case 15: {
                enum3 = 'dual-source-blending';
                break;
              }
              case 16: {
                enum3 = 'subgroups';
                break;
              }
              default: {
                throw new TypeError('invalid discriminant specified for GpuFeatureName');
              }
            }
            result4.push(enum3);
          }
          variant5 = result4;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant9;
      switch (arg5) {
        case 0: {
          variant9 = undefined;
          break;
        }
        case 1: {
          var handle7 = arg6;
          var rep8 = handleTable5[(handle7 << 1) + 1] & ~T_FLAG;
          var rsc6 = captureTable5.get(rep8);
          if (!rsc6) {
            rsc6 = Object.create(RecordOptionGpuSize64.prototype);
            Object.defineProperty(rsc6, symbolRscHandle, { writable: true, value: handle7});
            Object.defineProperty(rsc6, symbolRscRep, { writable: true, value: rep8});
          }
          else {
            captureTable5.delete(rep8);
          }
          rscTableRemove(handleTable5, handle7);
          variant9 = rsc6;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant12;
      switch (arg7) {
        case 0: {
          variant12 = undefined;
          break;
        }
        case 1: {
          let variant11;
          switch (arg8) {
            case 0: {
              variant11 = undefined;
              break;
            }
            case 1: {
              var ptr10 = arg9;
              var len10 = arg10;
              var result10 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr10, len10));
              variant11 = result10;
              break;
            }
            default: {
              throw new TypeError('invalid variant discriminant for option');
            }
          }
          variant12 = {
            label: variant11,
          };
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant14;
      switch (arg11) {
        case 0: {
          variant14 = undefined;
          break;
        }
        case 1: {
          var ptr13 = arg12;
          var len13 = arg13;
          var result13 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr13, len13));
          variant14 = result13;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      variant15 = {
        requiredFeatures: variant5,
        requiredLimits: variant9,
        defaultQueue: variant12,
        label: variant14,
      };
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-adapter.request-device"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]gpu-adapter.request-device');
  let ret;
  try {
    ret = { tag: 'ok', val: await rsc0.requestDevice(variant15)};
  } catch (e) {
    ret = { tag: 'err', val: getErrorPayload(e) };
  }
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-adapter.request-device"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  var variant20 = ret;
  switch (variant20.tag) {
    case 'ok': {
      const e = variant20.val;
      dataView(memory0).setInt8(arg14 + 0, 0, true);
      if (!(e instanceof GpuDevice)) {
        throw new TypeError('Resource error: Not a valid "GpuDevice" resource.');
      }
      var handle16 = e[symbolRscHandle];
      if (!handle16) {
        const rep = e[symbolRscRep] || ++captureCnt6;
        captureTable6.set(rep, e);
        handle16 = rscTableCreateOwn(handleTable6, rep);
      }
      dataView(memory0).setInt32(arg14 + 4, handle16, true);
      break;
    }
    case 'err': {
      const e = variant20.val;
      dataView(memory0).setInt8(arg14 + 0, 1, true);
      var {kind: v17_0, message: v17_1 } = e;
      var variant18 = v17_0;
      switch (variant18.tag) {
        case 'type-error': {
          dataView(memory0).setInt8(arg14 + 4, 0, true);
          break;
        }
        case 'operation-error': {
          dataView(memory0).setInt8(arg14 + 4, 1, true);
          break;
        }
        default: {
          throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant18.tag)}\` (received \`${variant18}\`) specified for \`RequestDeviceErrorKind\``);
        }
      }
      var ptr19 = utf8Encode(v17_1, realloc0, memory0);
      var len19 = utf8EncodedLen;
      dataView(memory0).setUint32(arg14 + 12, len19, true);
      dataView(memory0).setUint32(arg14 + 8, ptr19, true);
      break;
    }
    default: {
      throw new TypeError('invalid variant specified for result');
    }
  }
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-adapter.request-device"][Instruction::Return]', {
    funcName: '[method]gpu-adapter.request-device',
    paramCount: 0,
    async: false,
    postReturn: false
  });
}
);
const handleTable8 = [T_FLAG, 0];
const captureTable8= new Map();
let captureCnt8 = 0;
handleTables[8] = handleTable8;
const handleTable9 = [T_FLAG, 0];
const captureTable9= new Map();
let captureCnt9 = 0;
handleTables[9] = handleTable9;

function trampoline37(arg0, arg1, arg2, arg3, arg4, arg5) {
  var handle1 = arg0;
  var rep2 = handleTable6[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable6.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(GpuDevice.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  var len7 = arg2;
  var base7 = arg1;
  var result7 = [];
  for (let i = 0; i < len7; i++) {
    const base = base7 + i * 8;
    let variant6;
    switch (dataView(memory0).getUint8(base + 0, true)) {
      case 0: {
        variant6 = undefined;
        break;
      }
      case 1: {
        var handle4 = dataView(memory0).getInt32(base + 4, true);
        var rep5 = handleTable8[(handle4 << 1) + 1] & ~T_FLAG;
        var rsc3 = captureTable8.get(rep5);
        if (!rsc3) {
          rsc3 = Object.create(GpuBindGroupLayout.prototype);
          Object.defineProperty(rsc3, symbolRscHandle, { writable: true, value: handle4});
          Object.defineProperty(rsc3, symbolRscRep, { writable: true, value: rep5});
        }
        curResourceBorrows.push(rsc3);
        variant6 = rsc3;
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for option');
      }
    }
    result7.push(variant6);
  }
  let variant9;
  switch (arg3) {
    case 0: {
      variant9 = undefined;
      break;
    }
    case 1: {
      var ptr8 = arg4;
      var len8 = arg5;
      var result8 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr8, len8));
      variant9 = result8;
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-device.create-pipeline-layout"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]gpu-device.create-pipeline-layout');
  const ret = rsc0.createPipelineLayout({
    bindGroupLayouts: result7,
    label: variant9,
  });
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-device.create-pipeline-layout"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  if (!(ret instanceof GpuPipelineLayout)) {
    throw new TypeError('Resource error: Not a valid "GpuPipelineLayout" resource.');
  }
  var handle10 = ret[symbolRscHandle];
  if (!handle10) {
    const rep = ret[symbolRscRep] || ++captureCnt9;
    captureTable9.set(rep, ret);
    handle10 = rscTableCreateOwn(handleTable9, rep);
  }
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-device.create-pipeline-layout"][Instruction::Return]', {
    funcName: '[method]gpu-device.create-pipeline-layout',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  return handle10;
}

const handleTable10 = [T_FLAG, 0];
const captureTable10= new Map();
let captureCnt10 = 0;
handleTables[10] = handleTable10;

function trampoline38(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8) {
  var handle1 = arg0;
  var rep2 = handleTable6[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable6.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(GpuDevice.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  var ptr3 = arg1;
  var len3 = arg2;
  var result3 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr3, len3));
  let variant11;
  switch (arg3) {
    case 0: {
      variant11 = undefined;
      break;
    }
    case 1: {
      var len10 = arg5;
      var base10 = arg4;
      var result10 = [];
      for (let i = 0; i < len10; i++) {
        const base = base10 + i * 20;
        var ptr4 = dataView(memory0).getUint32(base + 0, true);
        var len4 = dataView(memory0).getUint32(base + 4, true);
        var result4 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr4, len4));
        let variant9;
        switch (dataView(memory0).getUint8(base + 8, true)) {
          case 0: {
            variant9 = undefined;
            break;
          }
          case 1: {
            let variant8;
            switch (dataView(memory0).getUint8(base + 12, true)) {
              case 0: {
                var handle6 = dataView(memory0).getInt32(base + 16, true);
                var rep7 = handleTable9[(handle6 << 1) + 1] & ~T_FLAG;
                var rsc5 = captureTable9.get(rep7);
                if (!rsc5) {
                  rsc5 = Object.create(GpuPipelineLayout.prototype);
                  Object.defineProperty(rsc5, symbolRscHandle, { writable: true, value: handle6});
                  Object.defineProperty(rsc5, symbolRscRep, { writable: true, value: rep7});
                }
                curResourceBorrows.push(rsc5);
                variant8= {
                  tag: 'specific',
                  val: rsc5
                };
                break;
              }
              case 1: {
                variant8= {
                  tag: 'auto',
                };
                break;
              }
              default: {
                throw new TypeError('invalid variant discriminant for GpuLayoutMode');
              }
            }
            variant9 = variant8;
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        result10.push({
          entryPoint: result4,
          layout: variant9,
        });
      }
      variant11 = result10;
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  let variant13;
  switch (arg6) {
    case 0: {
      variant13 = undefined;
      break;
    }
    case 1: {
      var ptr12 = arg7;
      var len12 = arg8;
      var result12 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr12, len12));
      variant13 = result12;
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-device.create-shader-module"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]gpu-device.create-shader-module');
  const ret = rsc0.createShaderModule({
    code: result3,
    compilationHints: variant11,
    label: variant13,
  });
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-device.create-shader-module"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  if (!(ret instanceof GpuShaderModule)) {
    throw new TypeError('Resource error: Not a valid "GpuShaderModule" resource.');
  }
  var handle14 = ret[symbolRscHandle];
  if (!handle14) {
    const rep = ret[symbolRscRep] || ++captureCnt10;
    captureTable10.set(rep, ret);
    handle14 = rscTableCreateOwn(handleTable10, rep);
  }
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-device.create-shader-module"][Instruction::Return]', {
    funcName: '[method]gpu-device.create-shader-module',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  return handle14;
}

const handleTable11 = [T_FLAG, 0];
const captureTable11= new Map();
let captureCnt11 = 0;
handleTables[11] = handleTable11;

function trampoline39(arg0) {
  var handle1 = dataView(memory0).getInt32(arg0 + 0, true);
  var rep2 = handleTable6[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable6.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(GpuDevice.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  let variant9;
  switch (dataView(memory0).getUint8(arg0 + 4, true)) {
    case 0: {
      variant9 = undefined;
      break;
    }
    case 1: {
      var len8 = dataView(memory0).getUint32(arg0 + 12, true);
      var base8 = dataView(memory0).getUint32(arg0 + 8, true);
      var result8 = [];
      for (let i = 0; i < len8; i++) {
        const base = base8 + i * 32;
        let variant7;
        switch (dataView(memory0).getUint8(base + 0, true)) {
          case 0: {
            variant7 = undefined;
            break;
          }
          case 1: {
            let variant4;
            switch (dataView(memory0).getUint8(base + 16, true)) {
              case 0: {
                variant4 = undefined;
                break;
              }
              case 1: {
                let enum3;
                switch (dataView(memory0).getUint8(base + 17, true)) {
                  case 0: {
                    enum3 = 'vertex';
                    break;
                  }
                  case 1: {
                    enum3 = 'instance';
                    break;
                  }
                  default: {
                    throw new TypeError('invalid discriminant specified for GpuVertexStepMode');
                  }
                }
                variant4 = enum3;
                break;
              }
              default: {
                throw new TypeError('invalid variant discriminant for option');
              }
            }
            var len6 = dataView(memory0).getUint32(base + 24, true);
            var base6 = dataView(memory0).getUint32(base + 20, true);
            var result6 = [];
            for (let i = 0; i < len6; i++) {
              const base = base6 + i * 24;
              let enum5;
              switch (dataView(memory0).getUint8(base + 0, true)) {
                case 0: {
                  enum5 = 'uint8';
                  break;
                }
                case 1: {
                  enum5 = 'uint8x2';
                  break;
                }
                case 2: {
                  enum5 = 'uint8x4';
                  break;
                }
                case 3: {
                  enum5 = 'sint8';
                  break;
                }
                case 4: {
                  enum5 = 'sint8x2';
                  break;
                }
                case 5: {
                  enum5 = 'sint8x4';
                  break;
                }
                case 6: {
                  enum5 = 'unorm8';
                  break;
                }
                case 7: {
                  enum5 = 'unorm8x2';
                  break;
                }
                case 8: {
                  enum5 = 'unorm8x4';
                  break;
                }
                case 9: {
                  enum5 = 'snorm8';
                  break;
                }
                case 10: {
                  enum5 = 'snorm8x2';
                  break;
                }
                case 11: {
                  enum5 = 'snorm8x4';
                  break;
                }
                case 12: {
                  enum5 = 'uint16';
                  break;
                }
                case 13: {
                  enum5 = 'uint16x2';
                  break;
                }
                case 14: {
                  enum5 = 'uint16x4';
                  break;
                }
                case 15: {
                  enum5 = 'sint16';
                  break;
                }
                case 16: {
                  enum5 = 'sint16x2';
                  break;
                }
                case 17: {
                  enum5 = 'sint16x4';
                  break;
                }
                case 18: {
                  enum5 = 'unorm16';
                  break;
                }
                case 19: {
                  enum5 = 'unorm16x2';
                  break;
                }
                case 20: {
                  enum5 = 'unorm16x4';
                  break;
                }
                case 21: {
                  enum5 = 'snorm16';
                  break;
                }
                case 22: {
                  enum5 = 'snorm16x2';
                  break;
                }
                case 23: {
                  enum5 = 'snorm16x4';
                  break;
                }
                case 24: {
                  enum5 = 'float16';
                  break;
                }
                case 25: {
                  enum5 = 'float16x2';
                  break;
                }
                case 26: {
                  enum5 = 'float16x4';
                  break;
                }
                case 27: {
                  enum5 = 'float32';
                  break;
                }
                case 28: {
                  enum5 = 'float32x2';
                  break;
                }
                case 29: {
                  enum5 = 'float32x3';
                  break;
                }
                case 30: {
                  enum5 = 'float32x4';
                  break;
                }
                case 31: {
                  enum5 = 'uint32';
                  break;
                }
                case 32: {
                  enum5 = 'uint32x2';
                  break;
                }
                case 33: {
                  enum5 = 'uint32x3';
                  break;
                }
                case 34: {
                  enum5 = 'uint32x4';
                  break;
                }
                case 35: {
                  enum5 = 'sint32';
                  break;
                }
                case 36: {
                  enum5 = 'sint32x2';
                  break;
                }
                case 37: {
                  enum5 = 'sint32x3';
                  break;
                }
                case 38: {
                  enum5 = 'sint32x4';
                  break;
                }
                case 39: {
                  enum5 = 'unorm1010102';
                  break;
                }
                case 40: {
                  enum5 = 'unorm8x4-bgra';
                  break;
                }
                default: {
                  throw new TypeError('invalid discriminant specified for GpuVertexFormat');
                }
              }
              result6.push({
                format: enum5,
                offset: BigInt.asUintN(64, dataView(memory0).getBigInt64(base + 8, true)),
                shaderLocation: dataView(memory0).getInt32(base + 16, true) >>> 0,
              });
            }
            variant7 = {
              arrayStride: BigInt.asUintN(64, dataView(memory0).getBigInt64(base + 8, true)),
              stepMode: variant4,
              attributes: result6,
            };
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        result8.push(variant7);
      }
      variant9 = result8;
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  var handle11 = dataView(memory0).getInt32(arg0 + 16, true);
  var rep12 = handleTable10[(handle11 << 1) + 1] & ~T_FLAG;
  var rsc10 = captureTable10.get(rep12);
  if (!rsc10) {
    rsc10 = Object.create(GpuShaderModule.prototype);
    Object.defineProperty(rsc10, symbolRscHandle, { writable: true, value: handle11});
    Object.defineProperty(rsc10, symbolRscRep, { writable: true, value: rep12});
  }
  curResourceBorrows.push(rsc10);
  let variant14;
  switch (dataView(memory0).getUint8(arg0 + 20, true)) {
    case 0: {
      variant14 = undefined;
      break;
    }
    case 1: {
      var ptr13 = dataView(memory0).getUint32(arg0 + 24, true);
      var len13 = dataView(memory0).getUint32(arg0 + 28, true);
      var result13 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr13, len13));
      variant14 = result13;
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  let variant18;
  switch (dataView(memory0).getUint8(arg0 + 32, true)) {
    case 0: {
      variant18 = undefined;
      break;
    }
    case 1: {
      var handle16 = dataView(memory0).getInt32(arg0 + 36, true);
      var rep17 = handleTable11[(handle16 << 1) + 1] & ~T_FLAG;
      var rsc15 = captureTable11.get(rep17);
      if (!rsc15) {
        rsc15 = Object.create(RecordGpuPipelineConstantValue.prototype);
        Object.defineProperty(rsc15, symbolRscHandle, { writable: true, value: handle16});
        Object.defineProperty(rsc15, symbolRscRep, { writable: true, value: rep17});
      }
      else {
        captureTable11.delete(rep17);
      }
      rscTableRemove(handleTable11, handle16);
      variant18 = rsc15;
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  let variant29;
  switch (dataView(memory0).getUint8(arg0 + 40, true)) {
    case 0: {
      variant29 = undefined;
      break;
    }
    case 1: {
      let variant20;
      switch (dataView(memory0).getUint8(arg0 + 41, true)) {
        case 0: {
          variant20 = undefined;
          break;
        }
        case 1: {
          let enum19;
          switch (dataView(memory0).getUint8(arg0 + 42, true)) {
            case 0: {
              enum19 = 'point-list';
              break;
            }
            case 1: {
              enum19 = 'line-list';
              break;
            }
            case 2: {
              enum19 = 'line-strip';
              break;
            }
            case 3: {
              enum19 = 'triangle-list';
              break;
            }
            case 4: {
              enum19 = 'triangle-strip';
              break;
            }
            default: {
              throw new TypeError('invalid discriminant specified for GpuPrimitiveTopology');
            }
          }
          variant20 = enum19;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant22;
      switch (dataView(memory0).getUint8(arg0 + 43, true)) {
        case 0: {
          variant22 = undefined;
          break;
        }
        case 1: {
          let enum21;
          switch (dataView(memory0).getUint8(arg0 + 44, true)) {
            case 0: {
              enum21 = 'uint16';
              break;
            }
            case 1: {
              enum21 = 'uint32';
              break;
            }
            default: {
              throw new TypeError('invalid discriminant specified for GpuIndexFormat');
            }
          }
          variant22 = enum21;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant24;
      switch (dataView(memory0).getUint8(arg0 + 45, true)) {
        case 0: {
          variant24 = undefined;
          break;
        }
        case 1: {
          let enum23;
          switch (dataView(memory0).getUint8(arg0 + 46, true)) {
            case 0: {
              enum23 = 'ccw';
              break;
            }
            case 1: {
              enum23 = 'cw';
              break;
            }
            default: {
              throw new TypeError('invalid discriminant specified for GpuFrontFace');
            }
          }
          variant24 = enum23;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant26;
      switch (dataView(memory0).getUint8(arg0 + 47, true)) {
        case 0: {
          variant26 = undefined;
          break;
        }
        case 1: {
          let enum25;
          switch (dataView(memory0).getUint8(arg0 + 48, true)) {
            case 0: {
              enum25 = 'none';
              break;
            }
            case 1: {
              enum25 = 'front';
              break;
            }
            case 2: {
              enum25 = 'back';
              break;
            }
            default: {
              throw new TypeError('invalid discriminant specified for GpuCullMode');
            }
          }
          variant26 = enum25;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant28;
      switch (dataView(memory0).getUint8(arg0 + 49, true)) {
        case 0: {
          variant28 = undefined;
          break;
        }
        case 1: {
          var bool27 = dataView(memory0).getUint8(arg0 + 50, true);
          variant28 = bool27 == 0 ? false : (bool27 == 1 ? true : throwInvalidBool());
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      variant29 = {
        topology: variant20,
        stripIndexFormat: variant22,
        frontFace: variant24,
        cullMode: variant26,
        unclippedDepth: variant28,
      };
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  let variant58;
  switch (dataView(memory0).getUint8(arg0 + 52, true)) {
    case 0: {
      variant58 = undefined;
      break;
    }
    case 1: {
      let enum30;
      switch (dataView(memory0).getUint8(arg0 + 56, true)) {
        case 0: {
          enum30 = 'r8unorm';
          break;
        }
        case 1: {
          enum30 = 'r8snorm';
          break;
        }
        case 2: {
          enum30 = 'r8uint';
          break;
        }
        case 3: {
          enum30 = 'r8sint';
          break;
        }
        case 4: {
          enum30 = 'r16uint';
          break;
        }
        case 5: {
          enum30 = 'r16sint';
          break;
        }
        case 6: {
          enum30 = 'r16float';
          break;
        }
        case 7: {
          enum30 = 'rg8unorm';
          break;
        }
        case 8: {
          enum30 = 'rg8snorm';
          break;
        }
        case 9: {
          enum30 = 'rg8uint';
          break;
        }
        case 10: {
          enum30 = 'rg8sint';
          break;
        }
        case 11: {
          enum30 = 'r32uint';
          break;
        }
        case 12: {
          enum30 = 'r32sint';
          break;
        }
        case 13: {
          enum30 = 'r32float';
          break;
        }
        case 14: {
          enum30 = 'rg16uint';
          break;
        }
        case 15: {
          enum30 = 'rg16sint';
          break;
        }
        case 16: {
          enum30 = 'rg16float';
          break;
        }
        case 17: {
          enum30 = 'rgba8unorm';
          break;
        }
        case 18: {
          enum30 = 'rgba8unorm-srgb';
          break;
        }
        case 19: {
          enum30 = 'rgba8snorm';
          break;
        }
        case 20: {
          enum30 = 'rgba8uint';
          break;
        }
        case 21: {
          enum30 = 'rgba8sint';
          break;
        }
        case 22: {
          enum30 = 'bgra8unorm';
          break;
        }
        case 23: {
          enum30 = 'bgra8unorm-srgb';
          break;
        }
        case 24: {
          enum30 = 'rgb9e5ufloat';
          break;
        }
        case 25: {
          enum30 = 'rgb10a2uint';
          break;
        }
        case 26: {
          enum30 = 'rgb10a2unorm';
          break;
        }
        case 27: {
          enum30 = 'rg11b10ufloat';
          break;
        }
        case 28: {
          enum30 = 'rg32uint';
          break;
        }
        case 29: {
          enum30 = 'rg32sint';
          break;
        }
        case 30: {
          enum30 = 'rg32float';
          break;
        }
        case 31: {
          enum30 = 'rgba16uint';
          break;
        }
        case 32: {
          enum30 = 'rgba16sint';
          break;
        }
        case 33: {
          enum30 = 'rgba16float';
          break;
        }
        case 34: {
          enum30 = 'rgba32uint';
          break;
        }
        case 35: {
          enum30 = 'rgba32sint';
          break;
        }
        case 36: {
          enum30 = 'rgba32float';
          break;
        }
        case 37: {
          enum30 = 'stencil8';
          break;
        }
        case 38: {
          enum30 = 'depth16unorm';
          break;
        }
        case 39: {
          enum30 = 'depth24plus';
          break;
        }
        case 40: {
          enum30 = 'depth24plus-stencil8';
          break;
        }
        case 41: {
          enum30 = 'depth32float';
          break;
        }
        case 42: {
          enum30 = 'depth32float-stencil8';
          break;
        }
        case 43: {
          enum30 = 'bc1-rgba-unorm';
          break;
        }
        case 44: {
          enum30 = 'bc1-rgba-unorm-srgb';
          break;
        }
        case 45: {
          enum30 = 'bc2-rgba-unorm';
          break;
        }
        case 46: {
          enum30 = 'bc2-rgba-unorm-srgb';
          break;
        }
        case 47: {
          enum30 = 'bc3-rgba-unorm';
          break;
        }
        case 48: {
          enum30 = 'bc3-rgba-unorm-srgb';
          break;
        }
        case 49: {
          enum30 = 'bc4-r-unorm';
          break;
        }
        case 50: {
          enum30 = 'bc4-r-snorm';
          break;
        }
        case 51: {
          enum30 = 'bc5-rg-unorm';
          break;
        }
        case 52: {
          enum30 = 'bc5-rg-snorm';
          break;
        }
        case 53: {
          enum30 = 'bc6h-rgb-ufloat';
          break;
        }
        case 54: {
          enum30 = 'bc6h-rgb-float';
          break;
        }
        case 55: {
          enum30 = 'bc7-rgba-unorm';
          break;
        }
        case 56: {
          enum30 = 'bc7-rgba-unorm-srgb';
          break;
        }
        case 57: {
          enum30 = 'etc2-rgb8unorm';
          break;
        }
        case 58: {
          enum30 = 'etc2-rgb8unorm-srgb';
          break;
        }
        case 59: {
          enum30 = 'etc2-rgb8a1unorm';
          break;
        }
        case 60: {
          enum30 = 'etc2-rgb8a1unorm-srgb';
          break;
        }
        case 61: {
          enum30 = 'etc2-rgba8unorm';
          break;
        }
        case 62: {
          enum30 = 'etc2-rgba8unorm-srgb';
          break;
        }
        case 63: {
          enum30 = 'eac-r11unorm';
          break;
        }
        case 64: {
          enum30 = 'eac-r11snorm';
          break;
        }
        case 65: {
          enum30 = 'eac-rg11unorm';
          break;
        }
        case 66: {
          enum30 = 'eac-rg11snorm';
          break;
        }
        case 67: {
          enum30 = 'astc4x4-unorm';
          break;
        }
        case 68: {
          enum30 = 'astc4x4-unorm-srgb';
          break;
        }
        case 69: {
          enum30 = 'astc5x4-unorm';
          break;
        }
        case 70: {
          enum30 = 'astc5x4-unorm-srgb';
          break;
        }
        case 71: {
          enum30 = 'astc5x5-unorm';
          break;
        }
        case 72: {
          enum30 = 'astc5x5-unorm-srgb';
          break;
        }
        case 73: {
          enum30 = 'astc6x5-unorm';
          break;
        }
        case 74: {
          enum30 = 'astc6x5-unorm-srgb';
          break;
        }
        case 75: {
          enum30 = 'astc6x6-unorm';
          break;
        }
        case 76: {
          enum30 = 'astc6x6-unorm-srgb';
          break;
        }
        case 77: {
          enum30 = 'astc8x5-unorm';
          break;
        }
        case 78: {
          enum30 = 'astc8x5-unorm-srgb';
          break;
        }
        case 79: {
          enum30 = 'astc8x6-unorm';
          break;
        }
        case 80: {
          enum30 = 'astc8x6-unorm-srgb';
          break;
        }
        case 81: {
          enum30 = 'astc8x8-unorm';
          break;
        }
        case 82: {
          enum30 = 'astc8x8-unorm-srgb';
          break;
        }
        case 83: {
          enum30 = 'astc10x5-unorm';
          break;
        }
        case 84: {
          enum30 = 'astc10x5-unorm-srgb';
          break;
        }
        case 85: {
          enum30 = 'astc10x6-unorm';
          break;
        }
        case 86: {
          enum30 = 'astc10x6-unorm-srgb';
          break;
        }
        case 87: {
          enum30 = 'astc10x8-unorm';
          break;
        }
        case 88: {
          enum30 = 'astc10x8-unorm-srgb';
          break;
        }
        case 89: {
          enum30 = 'astc10x10-unorm';
          break;
        }
        case 90: {
          enum30 = 'astc10x10-unorm-srgb';
          break;
        }
        case 91: {
          enum30 = 'astc12x10-unorm';
          break;
        }
        case 92: {
          enum30 = 'astc12x10-unorm-srgb';
          break;
        }
        case 93: {
          enum30 = 'astc12x12-unorm';
          break;
        }
        case 94: {
          enum30 = 'astc12x12-unorm-srgb';
          break;
        }
        default: {
          throw new TypeError('invalid discriminant specified for GpuTextureFormat');
        }
      }
      let variant32;
      switch (dataView(memory0).getUint8(arg0 + 57, true)) {
        case 0: {
          variant32 = undefined;
          break;
        }
        case 1: {
          var bool31 = dataView(memory0).getUint8(arg0 + 58, true);
          variant32 = bool31 == 0 ? false : (bool31 == 1 ? true : throwInvalidBool());
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant34;
      switch (dataView(memory0).getUint8(arg0 + 59, true)) {
        case 0: {
          variant34 = undefined;
          break;
        }
        case 1: {
          let enum33;
          switch (dataView(memory0).getUint8(arg0 + 60, true)) {
            case 0: {
              enum33 = 'never';
              break;
            }
            case 1: {
              enum33 = 'less';
              break;
            }
            case 2: {
              enum33 = 'equal';
              break;
            }
            case 3: {
              enum33 = 'less-equal';
              break;
            }
            case 4: {
              enum33 = 'greater';
              break;
            }
            case 5: {
              enum33 = 'not-equal';
              break;
            }
            case 6: {
              enum33 = 'greater-equal';
              break;
            }
            case 7: {
              enum33 = 'always';
              break;
            }
            default: {
              throw new TypeError('invalid discriminant specified for GpuCompareFunction');
            }
          }
          variant34 = enum33;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant43;
      switch (dataView(memory0).getUint8(arg0 + 61, true)) {
        case 0: {
          variant43 = undefined;
          break;
        }
        case 1: {
          let variant36;
          switch (dataView(memory0).getUint8(arg0 + 62, true)) {
            case 0: {
              variant36 = undefined;
              break;
            }
            case 1: {
              let enum35;
              switch (dataView(memory0).getUint8(arg0 + 63, true)) {
                case 0: {
                  enum35 = 'never';
                  break;
                }
                case 1: {
                  enum35 = 'less';
                  break;
                }
                case 2: {
                  enum35 = 'equal';
                  break;
                }
                case 3: {
                  enum35 = 'less-equal';
                  break;
                }
                case 4: {
                  enum35 = 'greater';
                  break;
                }
                case 5: {
                  enum35 = 'not-equal';
                  break;
                }
                case 6: {
                  enum35 = 'greater-equal';
                  break;
                }
                case 7: {
                  enum35 = 'always';
                  break;
                }
                default: {
                  throw new TypeError('invalid discriminant specified for GpuCompareFunction');
                }
              }
              variant36 = enum35;
              break;
            }
            default: {
              throw new TypeError('invalid variant discriminant for option');
            }
          }
          let variant38;
          switch (dataView(memory0).getUint8(arg0 + 64, true)) {
            case 0: {
              variant38 = undefined;
              break;
            }
            case 1: {
              let enum37;
              switch (dataView(memory0).getUint8(arg0 + 65, true)) {
                case 0: {
                  enum37 = 'keep';
                  break;
                }
                case 1: {
                  enum37 = 'zero';
                  break;
                }
                case 2: {
                  enum37 = 'replace';
                  break;
                }
                case 3: {
                  enum37 = 'invert';
                  break;
                }
                case 4: {
                  enum37 = 'increment-clamp';
                  break;
                }
                case 5: {
                  enum37 = 'decrement-clamp';
                  break;
                }
                case 6: {
                  enum37 = 'increment-wrap';
                  break;
                }
                case 7: {
                  enum37 = 'decrement-wrap';
                  break;
                }
                default: {
                  throw new TypeError('invalid discriminant specified for GpuStencilOperation');
                }
              }
              variant38 = enum37;
              break;
            }
            default: {
              throw new TypeError('invalid variant discriminant for option');
            }
          }
          let variant40;
          switch (dataView(memory0).getUint8(arg0 + 66, true)) {
            case 0: {
              variant40 = undefined;
              break;
            }
            case 1: {
              let enum39;
              switch (dataView(memory0).getUint8(arg0 + 67, true)) {
                case 0: {
                  enum39 = 'keep';
                  break;
                }
                case 1: {
                  enum39 = 'zero';
                  break;
                }
                case 2: {
                  enum39 = 'replace';
                  break;
                }
                case 3: {
                  enum39 = 'invert';
                  break;
                }
                case 4: {
                  enum39 = 'increment-clamp';
                  break;
                }
                case 5: {
                  enum39 = 'decrement-clamp';
                  break;
                }
                case 6: {
                  enum39 = 'increment-wrap';
                  break;
                }
                case 7: {
                  enum39 = 'decrement-wrap';
                  break;
                }
                default: {
                  throw new TypeError('invalid discriminant specified for GpuStencilOperation');
                }
              }
              variant40 = enum39;
              break;
            }
            default: {
              throw new TypeError('invalid variant discriminant for option');
            }
          }
          let variant42;
          switch (dataView(memory0).getUint8(arg0 + 68, true)) {
            case 0: {
              variant42 = undefined;
              break;
            }
            case 1: {
              let enum41;
              switch (dataView(memory0).getUint8(arg0 + 69, true)) {
                case 0: {
                  enum41 = 'keep';
                  break;
                }
                case 1: {
                  enum41 = 'zero';
                  break;
                }
                case 2: {
                  enum41 = 'replace';
                  break;
                }
                case 3: {
                  enum41 = 'invert';
                  break;
                }
                case 4: {
                  enum41 = 'increment-clamp';
                  break;
                }
                case 5: {
                  enum41 = 'decrement-clamp';
                  break;
                }
                case 6: {
                  enum41 = 'increment-wrap';
                  break;
                }
                case 7: {
                  enum41 = 'decrement-wrap';
                  break;
                }
                default: {
                  throw new TypeError('invalid discriminant specified for GpuStencilOperation');
                }
              }
              variant42 = enum41;
              break;
            }
            default: {
              throw new TypeError('invalid variant discriminant for option');
            }
          }
          variant43 = {
            compare: variant36,
            failOp: variant38,
            depthFailOp: variant40,
            passOp: variant42,
          };
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant52;
      switch (dataView(memory0).getUint8(arg0 + 70, true)) {
        case 0: {
          variant52 = undefined;
          break;
        }
        case 1: {
          let variant45;
          switch (dataView(memory0).getUint8(arg0 + 71, true)) {
            case 0: {
              variant45 = undefined;
              break;
            }
            case 1: {
              let enum44;
              switch (dataView(memory0).getUint8(arg0 + 72, true)) {
                case 0: {
                  enum44 = 'never';
                  break;
                }
                case 1: {
                  enum44 = 'less';
                  break;
                }
                case 2: {
                  enum44 = 'equal';
                  break;
                }
                case 3: {
                  enum44 = 'less-equal';
                  break;
                }
                case 4: {
                  enum44 = 'greater';
                  break;
                }
                case 5: {
                  enum44 = 'not-equal';
                  break;
                }
                case 6: {
                  enum44 = 'greater-equal';
                  break;
                }
                case 7: {
                  enum44 = 'always';
                  break;
                }
                default: {
                  throw new TypeError('invalid discriminant specified for GpuCompareFunction');
                }
              }
              variant45 = enum44;
              break;
            }
            default: {
              throw new TypeError('invalid variant discriminant for option');
            }
          }
          let variant47;
          switch (dataView(memory0).getUint8(arg0 + 73, true)) {
            case 0: {
              variant47 = undefined;
              break;
            }
            case 1: {
              let enum46;
              switch (dataView(memory0).getUint8(arg0 + 74, true)) {
                case 0: {
                  enum46 = 'keep';
                  break;
                }
                case 1: {
                  enum46 = 'zero';
                  break;
                }
                case 2: {
                  enum46 = 'replace';
                  break;
                }
                case 3: {
                  enum46 = 'invert';
                  break;
                }
                case 4: {
                  enum46 = 'increment-clamp';
                  break;
                }
                case 5: {
                  enum46 = 'decrement-clamp';
                  break;
                }
                case 6: {
                  enum46 = 'increment-wrap';
                  break;
                }
                case 7: {
                  enum46 = 'decrement-wrap';
                  break;
                }
                default: {
                  throw new TypeError('invalid discriminant specified for GpuStencilOperation');
                }
              }
              variant47 = enum46;
              break;
            }
            default: {
              throw new TypeError('invalid variant discriminant for option');
            }
          }
          let variant49;
          switch (dataView(memory0).getUint8(arg0 + 75, true)) {
            case 0: {
              variant49 = undefined;
              break;
            }
            case 1: {
              let enum48;
              switch (dataView(memory0).getUint8(arg0 + 76, true)) {
                case 0: {
                  enum48 = 'keep';
                  break;
                }
                case 1: {
                  enum48 = 'zero';
                  break;
                }
                case 2: {
                  enum48 = 'replace';
                  break;
                }
                case 3: {
                  enum48 = 'invert';
                  break;
                }
                case 4: {
                  enum48 = 'increment-clamp';
                  break;
                }
                case 5: {
                  enum48 = 'decrement-clamp';
                  break;
                }
                case 6: {
                  enum48 = 'increment-wrap';
                  break;
                }
                case 7: {
                  enum48 = 'decrement-wrap';
                  break;
                }
                default: {
                  throw new TypeError('invalid discriminant specified for GpuStencilOperation');
                }
              }
              variant49 = enum48;
              break;
            }
            default: {
              throw new TypeError('invalid variant discriminant for option');
            }
          }
          let variant51;
          switch (dataView(memory0).getUint8(arg0 + 77, true)) {
            case 0: {
              variant51 = undefined;
              break;
            }
            case 1: {
              let enum50;
              switch (dataView(memory0).getUint8(arg0 + 78, true)) {
                case 0: {
                  enum50 = 'keep';
                  break;
                }
                case 1: {
                  enum50 = 'zero';
                  break;
                }
                case 2: {
                  enum50 = 'replace';
                  break;
                }
                case 3: {
                  enum50 = 'invert';
                  break;
                }
                case 4: {
                  enum50 = 'increment-clamp';
                  break;
                }
                case 5: {
                  enum50 = 'decrement-clamp';
                  break;
                }
                case 6: {
                  enum50 = 'increment-wrap';
                  break;
                }
                case 7: {
                  enum50 = 'decrement-wrap';
                  break;
                }
                default: {
                  throw new TypeError('invalid discriminant specified for GpuStencilOperation');
                }
              }
              variant51 = enum50;
              break;
            }
            default: {
              throw new TypeError('invalid variant discriminant for option');
            }
          }
          variant52 = {
            compare: variant45,
            failOp: variant47,
            depthFailOp: variant49,
            passOp: variant51,
          };
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant53;
      switch (dataView(memory0).getUint8(arg0 + 80, true)) {
        case 0: {
          variant53 = undefined;
          break;
        }
        case 1: {
          variant53 = dataView(memory0).getInt32(arg0 + 84, true) >>> 0;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant54;
      switch (dataView(memory0).getUint8(arg0 + 88, true)) {
        case 0: {
          variant54 = undefined;
          break;
        }
        case 1: {
          variant54 = dataView(memory0).getInt32(arg0 + 92, true) >>> 0;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant55;
      switch (dataView(memory0).getUint8(arg0 + 96, true)) {
        case 0: {
          variant55 = undefined;
          break;
        }
        case 1: {
          variant55 = dataView(memory0).getInt32(arg0 + 100, true);
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant56;
      switch (dataView(memory0).getUint8(arg0 + 104, true)) {
        case 0: {
          variant56 = undefined;
          break;
        }
        case 1: {
          variant56 = dataView(memory0).getFloat32(arg0 + 108, true);
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant57;
      switch (dataView(memory0).getUint8(arg0 + 112, true)) {
        case 0: {
          variant57 = undefined;
          break;
        }
        case 1: {
          variant57 = dataView(memory0).getFloat32(arg0 + 116, true);
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      variant58 = {
        format: enum30,
        depthWriteEnabled: variant32,
        depthCompare: variant34,
        stencilFront: variant43,
        stencilBack: variant52,
        stencilReadMask: variant53,
        stencilWriteMask: variant54,
        depthBias: variant55,
        depthBiasSlopeScale: variant56,
        depthBiasClamp: variant57,
      };
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  let variant63;
  switch (dataView(memory0).getUint8(arg0 + 120, true)) {
    case 0: {
      variant63 = undefined;
      break;
    }
    case 1: {
      let variant59;
      switch (dataView(memory0).getUint8(arg0 + 124, true)) {
        case 0: {
          variant59 = undefined;
          break;
        }
        case 1: {
          variant59 = dataView(memory0).getInt32(arg0 + 128, true) >>> 0;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant60;
      switch (dataView(memory0).getUint8(arg0 + 132, true)) {
        case 0: {
          variant60 = undefined;
          break;
        }
        case 1: {
          variant60 = dataView(memory0).getInt32(arg0 + 136, true) >>> 0;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant62;
      switch (dataView(memory0).getUint8(arg0 + 140, true)) {
        case 0: {
          variant62 = undefined;
          break;
        }
        case 1: {
          var bool61 = dataView(memory0).getUint8(arg0 + 141, true);
          variant62 = bool61 == 0 ? false : (bool61 == 1 ? true : throwInvalidBool());
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      variant63 = {
        count: variant59,
        mask: variant60,
        alphaToCoverageEnabled: variant62,
      };
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  let variant90;
  switch (dataView(memory0).getUint8(arg0 + 144, true)) {
    case 0: {
      variant90 = undefined;
      break;
    }
    case 1: {
      var len80 = dataView(memory0).getUint32(arg0 + 152, true);
      var base80 = dataView(memory0).getUint32(arg0 + 148, true);
      var result80 = [];
      for (let i = 0; i < len80; i++) {
        const base = base80 + i * 28;
        let variant79;
        switch (dataView(memory0).getUint8(base + 0, true)) {
          case 0: {
            variant79 = undefined;
            break;
          }
          case 1: {
            let enum64;
            switch (dataView(memory0).getUint8(base + 4, true)) {
              case 0: {
                enum64 = 'r8unorm';
                break;
              }
              case 1: {
                enum64 = 'r8snorm';
                break;
              }
              case 2: {
                enum64 = 'r8uint';
                break;
              }
              case 3: {
                enum64 = 'r8sint';
                break;
              }
              case 4: {
                enum64 = 'r16uint';
                break;
              }
              case 5: {
                enum64 = 'r16sint';
                break;
              }
              case 6: {
                enum64 = 'r16float';
                break;
              }
              case 7: {
                enum64 = 'rg8unorm';
                break;
              }
              case 8: {
                enum64 = 'rg8snorm';
                break;
              }
              case 9: {
                enum64 = 'rg8uint';
                break;
              }
              case 10: {
                enum64 = 'rg8sint';
                break;
              }
              case 11: {
                enum64 = 'r32uint';
                break;
              }
              case 12: {
                enum64 = 'r32sint';
                break;
              }
              case 13: {
                enum64 = 'r32float';
                break;
              }
              case 14: {
                enum64 = 'rg16uint';
                break;
              }
              case 15: {
                enum64 = 'rg16sint';
                break;
              }
              case 16: {
                enum64 = 'rg16float';
                break;
              }
              case 17: {
                enum64 = 'rgba8unorm';
                break;
              }
              case 18: {
                enum64 = 'rgba8unorm-srgb';
                break;
              }
              case 19: {
                enum64 = 'rgba8snorm';
                break;
              }
              case 20: {
                enum64 = 'rgba8uint';
                break;
              }
              case 21: {
                enum64 = 'rgba8sint';
                break;
              }
              case 22: {
                enum64 = 'bgra8unorm';
                break;
              }
              case 23: {
                enum64 = 'bgra8unorm-srgb';
                break;
              }
              case 24: {
                enum64 = 'rgb9e5ufloat';
                break;
              }
              case 25: {
                enum64 = 'rgb10a2uint';
                break;
              }
              case 26: {
                enum64 = 'rgb10a2unorm';
                break;
              }
              case 27: {
                enum64 = 'rg11b10ufloat';
                break;
              }
              case 28: {
                enum64 = 'rg32uint';
                break;
              }
              case 29: {
                enum64 = 'rg32sint';
                break;
              }
              case 30: {
                enum64 = 'rg32float';
                break;
              }
              case 31: {
                enum64 = 'rgba16uint';
                break;
              }
              case 32: {
                enum64 = 'rgba16sint';
                break;
              }
              case 33: {
                enum64 = 'rgba16float';
                break;
              }
              case 34: {
                enum64 = 'rgba32uint';
                break;
              }
              case 35: {
                enum64 = 'rgba32sint';
                break;
              }
              case 36: {
                enum64 = 'rgba32float';
                break;
              }
              case 37: {
                enum64 = 'stencil8';
                break;
              }
              case 38: {
                enum64 = 'depth16unorm';
                break;
              }
              case 39: {
                enum64 = 'depth24plus';
                break;
              }
              case 40: {
                enum64 = 'depth24plus-stencil8';
                break;
              }
              case 41: {
                enum64 = 'depth32float';
                break;
              }
              case 42: {
                enum64 = 'depth32float-stencil8';
                break;
              }
              case 43: {
                enum64 = 'bc1-rgba-unorm';
                break;
              }
              case 44: {
                enum64 = 'bc1-rgba-unorm-srgb';
                break;
              }
              case 45: {
                enum64 = 'bc2-rgba-unorm';
                break;
              }
              case 46: {
                enum64 = 'bc2-rgba-unorm-srgb';
                break;
              }
              case 47: {
                enum64 = 'bc3-rgba-unorm';
                break;
              }
              case 48: {
                enum64 = 'bc3-rgba-unorm-srgb';
                break;
              }
              case 49: {
                enum64 = 'bc4-r-unorm';
                break;
              }
              case 50: {
                enum64 = 'bc4-r-snorm';
                break;
              }
              case 51: {
                enum64 = 'bc5-rg-unorm';
                break;
              }
              case 52: {
                enum64 = 'bc5-rg-snorm';
                break;
              }
              case 53: {
                enum64 = 'bc6h-rgb-ufloat';
                break;
              }
              case 54: {
                enum64 = 'bc6h-rgb-float';
                break;
              }
              case 55: {
                enum64 = 'bc7-rgba-unorm';
                break;
              }
              case 56: {
                enum64 = 'bc7-rgba-unorm-srgb';
                break;
              }
              case 57: {
                enum64 = 'etc2-rgb8unorm';
                break;
              }
              case 58: {
                enum64 = 'etc2-rgb8unorm-srgb';
                break;
              }
              case 59: {
                enum64 = 'etc2-rgb8a1unorm';
                break;
              }
              case 60: {
                enum64 = 'etc2-rgb8a1unorm-srgb';
                break;
              }
              case 61: {
                enum64 = 'etc2-rgba8unorm';
                break;
              }
              case 62: {
                enum64 = 'etc2-rgba8unorm-srgb';
                break;
              }
              case 63: {
                enum64 = 'eac-r11unorm';
                break;
              }
              case 64: {
                enum64 = 'eac-r11snorm';
                break;
              }
              case 65: {
                enum64 = 'eac-rg11unorm';
                break;
              }
              case 66: {
                enum64 = 'eac-rg11snorm';
                break;
              }
              case 67: {
                enum64 = 'astc4x4-unorm';
                break;
              }
              case 68: {
                enum64 = 'astc4x4-unorm-srgb';
                break;
              }
              case 69: {
                enum64 = 'astc5x4-unorm';
                break;
              }
              case 70: {
                enum64 = 'astc5x4-unorm-srgb';
                break;
              }
              case 71: {
                enum64 = 'astc5x5-unorm';
                break;
              }
              case 72: {
                enum64 = 'astc5x5-unorm-srgb';
                break;
              }
              case 73: {
                enum64 = 'astc6x5-unorm';
                break;
              }
              case 74: {
                enum64 = 'astc6x5-unorm-srgb';
                break;
              }
              case 75: {
                enum64 = 'astc6x6-unorm';
                break;
              }
              case 76: {
                enum64 = 'astc6x6-unorm-srgb';
                break;
              }
              case 77: {
                enum64 = 'astc8x5-unorm';
                break;
              }
              case 78: {
                enum64 = 'astc8x5-unorm-srgb';
                break;
              }
              case 79: {
                enum64 = 'astc8x6-unorm';
                break;
              }
              case 80: {
                enum64 = 'astc8x6-unorm-srgb';
                break;
              }
              case 81: {
                enum64 = 'astc8x8-unorm';
                break;
              }
              case 82: {
                enum64 = 'astc8x8-unorm-srgb';
                break;
              }
              case 83: {
                enum64 = 'astc10x5-unorm';
                break;
              }
              case 84: {
                enum64 = 'astc10x5-unorm-srgb';
                break;
              }
              case 85: {
                enum64 = 'astc10x6-unorm';
                break;
              }
              case 86: {
                enum64 = 'astc10x6-unorm-srgb';
                break;
              }
              case 87: {
                enum64 = 'astc10x8-unorm';
                break;
              }
              case 88: {
                enum64 = 'astc10x8-unorm-srgb';
                break;
              }
              case 89: {
                enum64 = 'astc10x10-unorm';
                break;
              }
              case 90: {
                enum64 = 'astc10x10-unorm-srgb';
                break;
              }
              case 91: {
                enum64 = 'astc12x10-unorm';
                break;
              }
              case 92: {
                enum64 = 'astc12x10-unorm-srgb';
                break;
              }
              case 93: {
                enum64 = 'astc12x12-unorm';
                break;
              }
              case 94: {
                enum64 = 'astc12x12-unorm-srgb';
                break;
              }
              default: {
                throw new TypeError('invalid discriminant specified for GpuTextureFormat');
              }
            }
            let variant77;
            switch (dataView(memory0).getUint8(base + 5, true)) {
              case 0: {
                variant77 = undefined;
                break;
              }
              case 1: {
                let variant66;
                switch (dataView(memory0).getUint8(base + 6, true)) {
                  case 0: {
                    variant66 = undefined;
                    break;
                  }
                  case 1: {
                    let enum65;
                    switch (dataView(memory0).getUint8(base + 7, true)) {
                      case 0: {
                        enum65 = 'add';
                        break;
                      }
                      case 1: {
                        enum65 = 'subtract';
                        break;
                      }
                      case 2: {
                        enum65 = 'reverse-subtract';
                        break;
                      }
                      case 3: {
                        enum65 = 'min';
                        break;
                      }
                      case 4: {
                        enum65 = 'max';
                        break;
                      }
                      default: {
                        throw new TypeError('invalid discriminant specified for GpuBlendOperation');
                      }
                    }
                    variant66 = enum65;
                    break;
                  }
                  default: {
                    throw new TypeError('invalid variant discriminant for option');
                  }
                }
                let variant68;
                switch (dataView(memory0).getUint8(base + 8, true)) {
                  case 0: {
                    variant68 = undefined;
                    break;
                  }
                  case 1: {
                    let enum67;
                    switch (dataView(memory0).getUint8(base + 9, true)) {
                      case 0: {
                        enum67 = 'zero';
                        break;
                      }
                      case 1: {
                        enum67 = 'one';
                        break;
                      }
                      case 2: {
                        enum67 = 'src';
                        break;
                      }
                      case 3: {
                        enum67 = 'one-minus-src';
                        break;
                      }
                      case 4: {
                        enum67 = 'src-alpha';
                        break;
                      }
                      case 5: {
                        enum67 = 'one-minus-src-alpha';
                        break;
                      }
                      case 6: {
                        enum67 = 'dst';
                        break;
                      }
                      case 7: {
                        enum67 = 'one-minus-dst';
                        break;
                      }
                      case 8: {
                        enum67 = 'dst-alpha';
                        break;
                      }
                      case 9: {
                        enum67 = 'one-minus-dst-alpha';
                        break;
                      }
                      case 10: {
                        enum67 = 'src-alpha-saturated';
                        break;
                      }
                      case 11: {
                        enum67 = 'constant';
                        break;
                      }
                      case 12: {
                        enum67 = 'one-minus-constant';
                        break;
                      }
                      case 13: {
                        enum67 = 'src1';
                        break;
                      }
                      case 14: {
                        enum67 = 'one-minus-src1';
                        break;
                      }
                      case 15: {
                        enum67 = 'src1-alpha';
                        break;
                      }
                      case 16: {
                        enum67 = 'one-minus-src1-alpha';
                        break;
                      }
                      default: {
                        throw new TypeError('invalid discriminant specified for GpuBlendFactor');
                      }
                    }
                    variant68 = enum67;
                    break;
                  }
                  default: {
                    throw new TypeError('invalid variant discriminant for option');
                  }
                }
                let variant70;
                switch (dataView(memory0).getUint8(base + 10, true)) {
                  case 0: {
                    variant70 = undefined;
                    break;
                  }
                  case 1: {
                    let enum69;
                    switch (dataView(memory0).getUint8(base + 11, true)) {
                      case 0: {
                        enum69 = 'zero';
                        break;
                      }
                      case 1: {
                        enum69 = 'one';
                        break;
                      }
                      case 2: {
                        enum69 = 'src';
                        break;
                      }
                      case 3: {
                        enum69 = 'one-minus-src';
                        break;
                      }
                      case 4: {
                        enum69 = 'src-alpha';
                        break;
                      }
                      case 5: {
                        enum69 = 'one-minus-src-alpha';
                        break;
                      }
                      case 6: {
                        enum69 = 'dst';
                        break;
                      }
                      case 7: {
                        enum69 = 'one-minus-dst';
                        break;
                      }
                      case 8: {
                        enum69 = 'dst-alpha';
                        break;
                      }
                      case 9: {
                        enum69 = 'one-minus-dst-alpha';
                        break;
                      }
                      case 10: {
                        enum69 = 'src-alpha-saturated';
                        break;
                      }
                      case 11: {
                        enum69 = 'constant';
                        break;
                      }
                      case 12: {
                        enum69 = 'one-minus-constant';
                        break;
                      }
                      case 13: {
                        enum69 = 'src1';
                        break;
                      }
                      case 14: {
                        enum69 = 'one-minus-src1';
                        break;
                      }
                      case 15: {
                        enum69 = 'src1-alpha';
                        break;
                      }
                      case 16: {
                        enum69 = 'one-minus-src1-alpha';
                        break;
                      }
                      default: {
                        throw new TypeError('invalid discriminant specified for GpuBlendFactor');
                      }
                    }
                    variant70 = enum69;
                    break;
                  }
                  default: {
                    throw new TypeError('invalid variant discriminant for option');
                  }
                }
                let variant72;
                switch (dataView(memory0).getUint8(base + 12, true)) {
                  case 0: {
                    variant72 = undefined;
                    break;
                  }
                  case 1: {
                    let enum71;
                    switch (dataView(memory0).getUint8(base + 13, true)) {
                      case 0: {
                        enum71 = 'add';
                        break;
                      }
                      case 1: {
                        enum71 = 'subtract';
                        break;
                      }
                      case 2: {
                        enum71 = 'reverse-subtract';
                        break;
                      }
                      case 3: {
                        enum71 = 'min';
                        break;
                      }
                      case 4: {
                        enum71 = 'max';
                        break;
                      }
                      default: {
                        throw new TypeError('invalid discriminant specified for GpuBlendOperation');
                      }
                    }
                    variant72 = enum71;
                    break;
                  }
                  default: {
                    throw new TypeError('invalid variant discriminant for option');
                  }
                }
                let variant74;
                switch (dataView(memory0).getUint8(base + 14, true)) {
                  case 0: {
                    variant74 = undefined;
                    break;
                  }
                  case 1: {
                    let enum73;
                    switch (dataView(memory0).getUint8(base + 15, true)) {
                      case 0: {
                        enum73 = 'zero';
                        break;
                      }
                      case 1: {
                        enum73 = 'one';
                        break;
                      }
                      case 2: {
                        enum73 = 'src';
                        break;
                      }
                      case 3: {
                        enum73 = 'one-minus-src';
                        break;
                      }
                      case 4: {
                        enum73 = 'src-alpha';
                        break;
                      }
                      case 5: {
                        enum73 = 'one-minus-src-alpha';
                        break;
                      }
                      case 6: {
                        enum73 = 'dst';
                        break;
                      }
                      case 7: {
                        enum73 = 'one-minus-dst';
                        break;
                      }
                      case 8: {
                        enum73 = 'dst-alpha';
                        break;
                      }
                      case 9: {
                        enum73 = 'one-minus-dst-alpha';
                        break;
                      }
                      case 10: {
                        enum73 = 'src-alpha-saturated';
                        break;
                      }
                      case 11: {
                        enum73 = 'constant';
                        break;
                      }
                      case 12: {
                        enum73 = 'one-minus-constant';
                        break;
                      }
                      case 13: {
                        enum73 = 'src1';
                        break;
                      }
                      case 14: {
                        enum73 = 'one-minus-src1';
                        break;
                      }
                      case 15: {
                        enum73 = 'src1-alpha';
                        break;
                      }
                      case 16: {
                        enum73 = 'one-minus-src1-alpha';
                        break;
                      }
                      default: {
                        throw new TypeError('invalid discriminant specified for GpuBlendFactor');
                      }
                    }
                    variant74 = enum73;
                    break;
                  }
                  default: {
                    throw new TypeError('invalid variant discriminant for option');
                  }
                }
                let variant76;
                switch (dataView(memory0).getUint8(base + 16, true)) {
                  case 0: {
                    variant76 = undefined;
                    break;
                  }
                  case 1: {
                    let enum75;
                    switch (dataView(memory0).getUint8(base + 17, true)) {
                      case 0: {
                        enum75 = 'zero';
                        break;
                      }
                      case 1: {
                        enum75 = 'one';
                        break;
                      }
                      case 2: {
                        enum75 = 'src';
                        break;
                      }
                      case 3: {
                        enum75 = 'one-minus-src';
                        break;
                      }
                      case 4: {
                        enum75 = 'src-alpha';
                        break;
                      }
                      case 5: {
                        enum75 = 'one-minus-src-alpha';
                        break;
                      }
                      case 6: {
                        enum75 = 'dst';
                        break;
                      }
                      case 7: {
                        enum75 = 'one-minus-dst';
                        break;
                      }
                      case 8: {
                        enum75 = 'dst-alpha';
                        break;
                      }
                      case 9: {
                        enum75 = 'one-minus-dst-alpha';
                        break;
                      }
                      case 10: {
                        enum75 = 'src-alpha-saturated';
                        break;
                      }
                      case 11: {
                        enum75 = 'constant';
                        break;
                      }
                      case 12: {
                        enum75 = 'one-minus-constant';
                        break;
                      }
                      case 13: {
                        enum75 = 'src1';
                        break;
                      }
                      case 14: {
                        enum75 = 'one-minus-src1';
                        break;
                      }
                      case 15: {
                        enum75 = 'src1-alpha';
                        break;
                      }
                      case 16: {
                        enum75 = 'one-minus-src1-alpha';
                        break;
                      }
                      default: {
                        throw new TypeError('invalid discriminant specified for GpuBlendFactor');
                      }
                    }
                    variant76 = enum75;
                    break;
                  }
                  default: {
                    throw new TypeError('invalid variant discriminant for option');
                  }
                }
                variant77 = {
                  color: {
                    operation: variant66,
                    srcFactor: variant68,
                    dstFactor: variant70,
                  },
                  alpha: {
                    operation: variant72,
                    srcFactor: variant74,
                    dstFactor: variant76,
                  },
                };
                break;
              }
              default: {
                throw new TypeError('invalid variant discriminant for option');
              }
            }
            let variant78;
            switch (dataView(memory0).getUint8(base + 20, true)) {
              case 0: {
                variant78 = undefined;
                break;
              }
              case 1: {
                variant78 = dataView(memory0).getInt32(base + 24, true) >>> 0;
                break;
              }
              default: {
                throw new TypeError('invalid variant discriminant for option');
              }
            }
            variant79 = {
              format: enum64,
              blend: variant77,
              writeMask: variant78,
            };
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        result80.push(variant79);
      }
      var handle82 = dataView(memory0).getInt32(arg0 + 156, true);
      var rep83 = handleTable10[(handle82 << 1) + 1] & ~T_FLAG;
      var rsc81 = captureTable10.get(rep83);
      if (!rsc81) {
        rsc81 = Object.create(GpuShaderModule.prototype);
        Object.defineProperty(rsc81, symbolRscHandle, { writable: true, value: handle82});
        Object.defineProperty(rsc81, symbolRscRep, { writable: true, value: rep83});
      }
      curResourceBorrows.push(rsc81);
      let variant85;
      switch (dataView(memory0).getUint8(arg0 + 160, true)) {
        case 0: {
          variant85 = undefined;
          break;
        }
        case 1: {
          var ptr84 = dataView(memory0).getUint32(arg0 + 164, true);
          var len84 = dataView(memory0).getUint32(arg0 + 168, true);
          var result84 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr84, len84));
          variant85 = result84;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant89;
      switch (dataView(memory0).getUint8(arg0 + 172, true)) {
        case 0: {
          variant89 = undefined;
          break;
        }
        case 1: {
          var handle87 = dataView(memory0).getInt32(arg0 + 176, true);
          var rep88 = handleTable11[(handle87 << 1) + 1] & ~T_FLAG;
          var rsc86 = captureTable11.get(rep88);
          if (!rsc86) {
            rsc86 = Object.create(RecordGpuPipelineConstantValue.prototype);
            Object.defineProperty(rsc86, symbolRscHandle, { writable: true, value: handle87});
            Object.defineProperty(rsc86, symbolRscRep, { writable: true, value: rep88});
          }
          else {
            captureTable11.delete(rep88);
          }
          rscTableRemove(handleTable11, handle87);
          variant89 = rsc86;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      variant90 = {
        targets: result80,
        module: rsc81,
        entryPoint: variant85,
        constants: variant89,
      };
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  let variant94;
  switch (dataView(memory0).getUint8(arg0 + 180, true)) {
    case 0: {
      var handle92 = dataView(memory0).getInt32(arg0 + 184, true);
      var rep93 = handleTable9[(handle92 << 1) + 1] & ~T_FLAG;
      var rsc91 = captureTable9.get(rep93);
      if (!rsc91) {
        rsc91 = Object.create(GpuPipelineLayout.prototype);
        Object.defineProperty(rsc91, symbolRscHandle, { writable: true, value: handle92});
        Object.defineProperty(rsc91, symbolRscRep, { writable: true, value: rep93});
      }
      curResourceBorrows.push(rsc91);
      variant94= {
        tag: 'specific',
        val: rsc91
      };
      break;
    }
    case 1: {
      variant94= {
        tag: 'auto',
      };
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for GpuLayoutMode');
    }
  }
  let variant96;
  switch (dataView(memory0).getUint8(arg0 + 188, true)) {
    case 0: {
      variant96 = undefined;
      break;
    }
    case 1: {
      var ptr95 = dataView(memory0).getUint32(arg0 + 192, true);
      var len95 = dataView(memory0).getUint32(arg0 + 196, true);
      var result95 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr95, len95));
      variant96 = result95;
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-device.create-render-pipeline"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]gpu-device.create-render-pipeline');
  const ret = rsc0.createRenderPipeline({
    vertex: {
      buffers: variant9,
      module: rsc10,
      entryPoint: variant14,
      constants: variant18,
    },
    primitive: variant29,
    depthStencil: variant58,
    multisample: variant63,
    fragment: variant90,
    layout: variant94,
    label: variant96,
  });
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-device.create-render-pipeline"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  if (!(ret instanceof GpuRenderPipeline)) {
    throw new TypeError('Resource error: Not a valid "GpuRenderPipeline" resource.');
  }
  var handle97 = ret[symbolRscHandle];
  if (!handle97) {
    const rep = ret[symbolRscRep] || ++captureCnt12;
    captureTable12.set(rep, ret);
    handle97 = rscTableCreateOwn(handleTable12, rep);
  }
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-device.create-render-pipeline"][Instruction::Return]', {
    funcName: '[method]gpu-device.create-render-pipeline',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  return handle97;
}

const handleTable13 = [T_FLAG, 0];
const captureTable13= new Map();
let captureCnt13 = 0;
handleTables[13] = handleTable13;

function trampoline40(arg0, arg1, arg2, arg3, arg4) {
  var handle1 = arg0;
  var rep2 = handleTable6[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable6.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(GpuDevice.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  let variant5;
  switch (arg1) {
    case 0: {
      variant5 = undefined;
      break;
    }
    case 1: {
      let variant4;
      switch (arg2) {
        case 0: {
          variant4 = undefined;
          break;
        }
        case 1: {
          var ptr3 = arg3;
          var len3 = arg4;
          var result3 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr3, len3));
          variant4 = result3;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      variant5 = {
        label: variant4,
      };
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-device.create-command-encoder"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]gpu-device.create-command-encoder');
  const ret = rsc0.createCommandEncoder(variant5);
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-device.create-command-encoder"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  if (!(ret instanceof GpuCommandEncoder)) {
    throw new TypeError('Resource error: Not a valid "GpuCommandEncoder" resource.');
  }
  var handle6 = ret[symbolRscHandle];
  if (!handle6) {
    const rep = ret[symbolRscRep] || ++captureCnt13;
    captureTable13.set(rep, ret);
    handle6 = rscTableCreateOwn(handleTable13, rep);
  }
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-device.create-command-encoder"][Instruction::Return]', {
    funcName: '[method]gpu-device.create-command-encoder',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  return handle6;
}

const handleTable15 = [T_FLAG, 0];
const captureTable15= new Map();
let captureCnt15 = 0;
handleTables[15] = handleTable15;

function trampoline41(arg0) {
  var handle1 = dataView(memory0).getInt32(arg0 + 0, true);
  var rep2 = handleTable14[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable14.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(GpuTexture.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  let variant16;
  switch (dataView(memory0).getUint8(arg0 + 4, true)) {
    case 0: {
      variant16 = undefined;
      break;
    }
    case 1: {
      let variant4;
      switch (dataView(memory0).getUint8(arg0 + 8, true)) {
        case 0: {
          variant4 = undefined;
          break;
        }
        case 1: {
          let enum3;
          switch (dataView(memory0).getUint8(arg0 + 9, true)) {
            case 0: {
              enum3 = 'r8unorm';
              break;
            }
            case 1: {
              enum3 = 'r8snorm';
              break;
            }
            case 2: {
              enum3 = 'r8uint';
              break;
            }
            case 3: {
              enum3 = 'r8sint';
              break;
            }
            case 4: {
              enum3 = 'r16uint';
              break;
            }
            case 5: {
              enum3 = 'r16sint';
              break;
            }
            case 6: {
              enum3 = 'r16float';
              break;
            }
            case 7: {
              enum3 = 'rg8unorm';
              break;
            }
            case 8: {
              enum3 = 'rg8snorm';
              break;
            }
            case 9: {
              enum3 = 'rg8uint';
              break;
            }
            case 10: {
              enum3 = 'rg8sint';
              break;
            }
            case 11: {
              enum3 = 'r32uint';
              break;
            }
            case 12: {
              enum3 = 'r32sint';
              break;
            }
            case 13: {
              enum3 = 'r32float';
              break;
            }
            case 14: {
              enum3 = 'rg16uint';
              break;
            }
            case 15: {
              enum3 = 'rg16sint';
              break;
            }
            case 16: {
              enum3 = 'rg16float';
              break;
            }
            case 17: {
              enum3 = 'rgba8unorm';
              break;
            }
            case 18: {
              enum3 = 'rgba8unorm-srgb';
              break;
            }
            case 19: {
              enum3 = 'rgba8snorm';
              break;
            }
            case 20: {
              enum3 = 'rgba8uint';
              break;
            }
            case 21: {
              enum3 = 'rgba8sint';
              break;
            }
            case 22: {
              enum3 = 'bgra8unorm';
              break;
            }
            case 23: {
              enum3 = 'bgra8unorm-srgb';
              break;
            }
            case 24: {
              enum3 = 'rgb9e5ufloat';
              break;
            }
            case 25: {
              enum3 = 'rgb10a2uint';
              break;
            }
            case 26: {
              enum3 = 'rgb10a2unorm';
              break;
            }
            case 27: {
              enum3 = 'rg11b10ufloat';
              break;
            }
            case 28: {
              enum3 = 'rg32uint';
              break;
            }
            case 29: {
              enum3 = 'rg32sint';
              break;
            }
            case 30: {
              enum3 = 'rg32float';
              break;
            }
            case 31: {
              enum3 = 'rgba16uint';
              break;
            }
            case 32: {
              enum3 = 'rgba16sint';
              break;
            }
            case 33: {
              enum3 = 'rgba16float';
              break;
            }
            case 34: {
              enum3 = 'rgba32uint';
              break;
            }
            case 35: {
              enum3 = 'rgba32sint';
              break;
            }
            case 36: {
              enum3 = 'rgba32float';
              break;
            }
            case 37: {
              enum3 = 'stencil8';
              break;
            }
            case 38: {
              enum3 = 'depth16unorm';
              break;
            }
            case 39: {
              enum3 = 'depth24plus';
              break;
            }
            case 40: {
              enum3 = 'depth24plus-stencil8';
              break;
            }
            case 41: {
              enum3 = 'depth32float';
              break;
            }
            case 42: {
              enum3 = 'depth32float-stencil8';
              break;
            }
            case 43: {
              enum3 = 'bc1-rgba-unorm';
              break;
            }
            case 44: {
              enum3 = 'bc1-rgba-unorm-srgb';
              break;
            }
            case 45: {
              enum3 = 'bc2-rgba-unorm';
              break;
            }
            case 46: {
              enum3 = 'bc2-rgba-unorm-srgb';
              break;
            }
            case 47: {
              enum3 = 'bc3-rgba-unorm';
              break;
            }
            case 48: {
              enum3 = 'bc3-rgba-unorm-srgb';
              break;
            }
            case 49: {
              enum3 = 'bc4-r-unorm';
              break;
            }
            case 50: {
              enum3 = 'bc4-r-snorm';
              break;
            }
            case 51: {
              enum3 = 'bc5-rg-unorm';
              break;
            }
            case 52: {
              enum3 = 'bc5-rg-snorm';
              break;
            }
            case 53: {
              enum3 = 'bc6h-rgb-ufloat';
              break;
            }
            case 54: {
              enum3 = 'bc6h-rgb-float';
              break;
            }
            case 55: {
              enum3 = 'bc7-rgba-unorm';
              break;
            }
            case 56: {
              enum3 = 'bc7-rgba-unorm-srgb';
              break;
            }
            case 57: {
              enum3 = 'etc2-rgb8unorm';
              break;
            }
            case 58: {
              enum3 = 'etc2-rgb8unorm-srgb';
              break;
            }
            case 59: {
              enum3 = 'etc2-rgb8a1unorm';
              break;
            }
            case 60: {
              enum3 = 'etc2-rgb8a1unorm-srgb';
              break;
            }
            case 61: {
              enum3 = 'etc2-rgba8unorm';
              break;
            }
            case 62: {
              enum3 = 'etc2-rgba8unorm-srgb';
              break;
            }
            case 63: {
              enum3 = 'eac-r11unorm';
              break;
            }
            case 64: {
              enum3 = 'eac-r11snorm';
              break;
            }
            case 65: {
              enum3 = 'eac-rg11unorm';
              break;
            }
            case 66: {
              enum3 = 'eac-rg11snorm';
              break;
            }
            case 67: {
              enum3 = 'astc4x4-unorm';
              break;
            }
            case 68: {
              enum3 = 'astc4x4-unorm-srgb';
              break;
            }
            case 69: {
              enum3 = 'astc5x4-unorm';
              break;
            }
            case 70: {
              enum3 = 'astc5x4-unorm-srgb';
              break;
            }
            case 71: {
              enum3 = 'astc5x5-unorm';
              break;
            }
            case 72: {
              enum3 = 'astc5x5-unorm-srgb';
              break;
            }
            case 73: {
              enum3 = 'astc6x5-unorm';
              break;
            }
            case 74: {
              enum3 = 'astc6x5-unorm-srgb';
              break;
            }
            case 75: {
              enum3 = 'astc6x6-unorm';
              break;
            }
            case 76: {
              enum3 = 'astc6x6-unorm-srgb';
              break;
            }
            case 77: {
              enum3 = 'astc8x5-unorm';
              break;
            }
            case 78: {
              enum3 = 'astc8x5-unorm-srgb';
              break;
            }
            case 79: {
              enum3 = 'astc8x6-unorm';
              break;
            }
            case 80: {
              enum3 = 'astc8x6-unorm-srgb';
              break;
            }
            case 81: {
              enum3 = 'astc8x8-unorm';
              break;
            }
            case 82: {
              enum3 = 'astc8x8-unorm-srgb';
              break;
            }
            case 83: {
              enum3 = 'astc10x5-unorm';
              break;
            }
            case 84: {
              enum3 = 'astc10x5-unorm-srgb';
              break;
            }
            case 85: {
              enum3 = 'astc10x6-unorm';
              break;
            }
            case 86: {
              enum3 = 'astc10x6-unorm-srgb';
              break;
            }
            case 87: {
              enum3 = 'astc10x8-unorm';
              break;
            }
            case 88: {
              enum3 = 'astc10x8-unorm-srgb';
              break;
            }
            case 89: {
              enum3 = 'astc10x10-unorm';
              break;
            }
            case 90: {
              enum3 = 'astc10x10-unorm-srgb';
              break;
            }
            case 91: {
              enum3 = 'astc12x10-unorm';
              break;
            }
            case 92: {
              enum3 = 'astc12x10-unorm-srgb';
              break;
            }
            case 93: {
              enum3 = 'astc12x12-unorm';
              break;
            }
            case 94: {
              enum3 = 'astc12x12-unorm-srgb';
              break;
            }
            default: {
              throw new TypeError('invalid discriminant specified for GpuTextureFormat');
            }
          }
          variant4 = enum3;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant6;
      switch (dataView(memory0).getUint8(arg0 + 10, true)) {
        case 0: {
          variant6 = undefined;
          break;
        }
        case 1: {
          let enum5;
          switch (dataView(memory0).getUint8(arg0 + 11, true)) {
            case 0: {
              enum5 = 'd1';
              break;
            }
            case 1: {
              enum5 = 'd2';
              break;
            }
            case 2: {
              enum5 = 'd2-array';
              break;
            }
            case 3: {
              enum5 = 'cube';
              break;
            }
            case 4: {
              enum5 = 'cube-array';
              break;
            }
            case 5: {
              enum5 = 'd3';
              break;
            }
            default: {
              throw new TypeError('invalid discriminant specified for GpuTextureViewDimension');
            }
          }
          variant6 = enum5;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant7;
      switch (dataView(memory0).getUint8(arg0 + 12, true)) {
        case 0: {
          variant7 = undefined;
          break;
        }
        case 1: {
          variant7 = dataView(memory0).getInt32(arg0 + 16, true) >>> 0;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant9;
      switch (dataView(memory0).getUint8(arg0 + 20, true)) {
        case 0: {
          variant9 = undefined;
          break;
        }
        case 1: {
          let enum8;
          switch (dataView(memory0).getUint8(arg0 + 21, true)) {
            case 0: {
              enum8 = 'all';
              break;
            }
            case 1: {
              enum8 = 'stencil-only';
              break;
            }
            case 2: {
              enum8 = 'depth-only';
              break;
            }
            default: {
              throw new TypeError('invalid discriminant specified for GpuTextureAspect');
            }
          }
          variant9 = enum8;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant10;
      switch (dataView(memory0).getUint8(arg0 + 24, true)) {
        case 0: {
          variant10 = undefined;
          break;
        }
        case 1: {
          variant10 = dataView(memory0).getInt32(arg0 + 28, true) >>> 0;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant11;
      switch (dataView(memory0).getUint8(arg0 + 32, true)) {
        case 0: {
          variant11 = undefined;
          break;
        }
        case 1: {
          variant11 = dataView(memory0).getInt32(arg0 + 36, true) >>> 0;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant12;
      switch (dataView(memory0).getUint8(arg0 + 40, true)) {
        case 0: {
          variant12 = undefined;
          break;
        }
        case 1: {
          variant12 = dataView(memory0).getInt32(arg0 + 44, true) >>> 0;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant13;
      switch (dataView(memory0).getUint8(arg0 + 48, true)) {
        case 0: {
          variant13 = undefined;
          break;
        }
        case 1: {
          variant13 = dataView(memory0).getInt32(arg0 + 52, true) >>> 0;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant15;
      switch (dataView(memory0).getUint8(arg0 + 56, true)) {
        case 0: {
          variant15 = undefined;
          break;
        }
        case 1: {
          var ptr14 = dataView(memory0).getUint32(arg0 + 60, true);
          var len14 = dataView(memory0).getUint32(arg0 + 64, true);
          var result14 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr14, len14));
          variant15 = result14;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      variant16 = {
        format: variant4,
        dimension: variant6,
        usage: variant7,
        aspect: variant9,
        baseMipLevel: variant10,
        mipLevelCount: variant11,
        baseArrayLayer: variant12,
        arrayLayerCount: variant13,
        label: variant15,
      };
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-texture.create-view"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]gpu-texture.create-view');
  const ret = rsc0.createView(variant16);
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-texture.create-view"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  if (!(ret instanceof GpuTextureView)) {
    throw new TypeError('Resource error: Not a valid "GpuTextureView" resource.');
  }
  var handle17 = ret[symbolRscHandle];
  if (!handle17) {
    const rep = ret[symbolRscRep] || ++captureCnt15;
    captureTable15.set(rep, ret);
    handle17 = rscTableCreateOwn(handleTable15, rep);
  }
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-texture.create-view"][Instruction::Return]', {
    funcName: '[method]gpu-texture.create-view',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  return handle17;
}

const handleTable16 = [T_FLAG, 0];
const captureTable16= new Map();
let captureCnt16 = 0;
handleTables[16] = handleTable16;

function trampoline42(arg0) {
  var handle1 = dataView(memory0).getInt32(arg0 + 0, true);
  var rep2 = handleTable13[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable13.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(GpuCommandEncoder.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  var len15 = dataView(memory0).getUint32(arg0 + 12, true);
  var base15 = dataView(memory0).getUint32(arg0 + 8, true);
  var result15 = [];
  for (let i = 0; i < len15; i++) {
    const base = base15 + i * 80;
    let variant14;
    switch (dataView(memory0).getUint8(base + 0, true)) {
      case 0: {
        variant14 = undefined;
        break;
      }
      case 1: {
        var handle4 = dataView(memory0).getInt32(base + 8, true);
        var rep5 = handleTable15[(handle4 << 1) + 1] & ~T_FLAG;
        var rsc3 = captureTable15.get(rep5);
        if (!rsc3) {
          rsc3 = Object.create(GpuTextureView.prototype);
          Object.defineProperty(rsc3, symbolRscHandle, { writable: true, value: handle4});
          Object.defineProperty(rsc3, symbolRscRep, { writable: true, value: rep5});
        }
        curResourceBorrows.push(rsc3);
        let variant6;
        switch (dataView(memory0).getUint8(base + 12, true)) {
          case 0: {
            variant6 = undefined;
            break;
          }
          case 1: {
            variant6 = dataView(memory0).getInt32(base + 16, true) >>> 0;
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        let variant10;
        switch (dataView(memory0).getUint8(base + 20, true)) {
          case 0: {
            variant10 = undefined;
            break;
          }
          case 1: {
            var handle8 = dataView(memory0).getInt32(base + 24, true);
            var rep9 = handleTable15[(handle8 << 1) + 1] & ~T_FLAG;
            var rsc7 = captureTable15.get(rep9);
            if (!rsc7) {
              rsc7 = Object.create(GpuTextureView.prototype);
              Object.defineProperty(rsc7, symbolRscHandle, { writable: true, value: handle8});
              Object.defineProperty(rsc7, symbolRscRep, { writable: true, value: rep9});
            }
            curResourceBorrows.push(rsc7);
            variant10 = rsc7;
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        let variant11;
        switch (dataView(memory0).getUint8(base + 32, true)) {
          case 0: {
            variant11 = undefined;
            break;
          }
          case 1: {
            variant11 = {
              r: dataView(memory0).getFloat64(base + 40, true),
              g: dataView(memory0).getFloat64(base + 48, true),
              b: dataView(memory0).getFloat64(base + 56, true),
              a: dataView(memory0).getFloat64(base + 64, true),
            };
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        let enum12;
        switch (dataView(memory0).getUint8(base + 72, true)) {
          case 0: {
            enum12 = 'load';
            break;
          }
          case 1: {
            enum12 = 'clear';
            break;
          }
          default: {
            throw new TypeError('invalid discriminant specified for GpuLoadOp');
          }
        }
        let enum13;
        switch (dataView(memory0).getUint8(base + 73, true)) {
          case 0: {
            enum13 = 'store';
            break;
          }
          case 1: {
            enum13 = 'discard';
            break;
          }
          default: {
            throw new TypeError('invalid discriminant specified for GpuStoreOp');
          }
        }
        variant14 = {
          view: rsc3,
          depthSlice: variant6,
          resolveTarget: variant10,
          clearValue: variant11,
          loadOp: enum12,
          storeOp: enum13,
        };
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for option');
      }
    }
    result15.push(variant14);
  }
  let variant33;
  switch (dataView(memory0).getUint8(arg0 + 16, true)) {
    case 0: {
      variant33 = undefined;
      break;
    }
    case 1: {
      var handle17 = dataView(memory0).getInt32(arg0 + 20, true);
      var rep18 = handleTable15[(handle17 << 1) + 1] & ~T_FLAG;
      var rsc16 = captureTable15.get(rep18);
      if (!rsc16) {
        rsc16 = Object.create(GpuTextureView.prototype);
        Object.defineProperty(rsc16, symbolRscHandle, { writable: true, value: handle17});
        Object.defineProperty(rsc16, symbolRscRep, { writable: true, value: rep18});
      }
      curResourceBorrows.push(rsc16);
      let variant19;
      switch (dataView(memory0).getUint8(arg0 + 24, true)) {
        case 0: {
          variant19 = undefined;
          break;
        }
        case 1: {
          variant19 = dataView(memory0).getFloat32(arg0 + 28, true);
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant21;
      switch (dataView(memory0).getUint8(arg0 + 32, true)) {
        case 0: {
          variant21 = undefined;
          break;
        }
        case 1: {
          let enum20;
          switch (dataView(memory0).getUint8(arg0 + 33, true)) {
            case 0: {
              enum20 = 'load';
              break;
            }
            case 1: {
              enum20 = 'clear';
              break;
            }
            default: {
              throw new TypeError('invalid discriminant specified for GpuLoadOp');
            }
          }
          variant21 = enum20;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant23;
      switch (dataView(memory0).getUint8(arg0 + 34, true)) {
        case 0: {
          variant23 = undefined;
          break;
        }
        case 1: {
          let enum22;
          switch (dataView(memory0).getUint8(arg0 + 35, true)) {
            case 0: {
              enum22 = 'store';
              break;
            }
            case 1: {
              enum22 = 'discard';
              break;
            }
            default: {
              throw new TypeError('invalid discriminant specified for GpuStoreOp');
            }
          }
          variant23 = enum22;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant25;
      switch (dataView(memory0).getUint8(arg0 + 36, true)) {
        case 0: {
          variant25 = undefined;
          break;
        }
        case 1: {
          var bool24 = dataView(memory0).getUint8(arg0 + 37, true);
          variant25 = bool24 == 0 ? false : (bool24 == 1 ? true : throwInvalidBool());
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant26;
      switch (dataView(memory0).getUint8(arg0 + 40, true)) {
        case 0: {
          variant26 = undefined;
          break;
        }
        case 1: {
          variant26 = dataView(memory0).getInt32(arg0 + 44, true) >>> 0;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant28;
      switch (dataView(memory0).getUint8(arg0 + 48, true)) {
        case 0: {
          variant28 = undefined;
          break;
        }
        case 1: {
          let enum27;
          switch (dataView(memory0).getUint8(arg0 + 49, true)) {
            case 0: {
              enum27 = 'load';
              break;
            }
            case 1: {
              enum27 = 'clear';
              break;
            }
            default: {
              throw new TypeError('invalid discriminant specified for GpuLoadOp');
            }
          }
          variant28 = enum27;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant30;
      switch (dataView(memory0).getUint8(arg0 + 50, true)) {
        case 0: {
          variant30 = undefined;
          break;
        }
        case 1: {
          let enum29;
          switch (dataView(memory0).getUint8(arg0 + 51, true)) {
            case 0: {
              enum29 = 'store';
              break;
            }
            case 1: {
              enum29 = 'discard';
              break;
            }
            default: {
              throw new TypeError('invalid discriminant specified for GpuStoreOp');
            }
          }
          variant30 = enum29;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant32;
      switch (dataView(memory0).getUint8(arg0 + 52, true)) {
        case 0: {
          variant32 = undefined;
          break;
        }
        case 1: {
          var bool31 = dataView(memory0).getUint8(arg0 + 53, true);
          variant32 = bool31 == 0 ? false : (bool31 == 1 ? true : throwInvalidBool());
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      variant33 = {
        view: rsc16,
        depthClearValue: variant19,
        depthLoadOp: variant21,
        depthStoreOp: variant23,
        depthReadOnly: variant25,
        stencilClearValue: variant26,
        stencilLoadOp: variant28,
        stencilStoreOp: variant30,
        stencilReadOnly: variant32,
      };
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  let variant37;
  switch (dataView(memory0).getUint8(arg0 + 56, true)) {
    case 0: {
      variant37 = undefined;
      break;
    }
    case 1: {
      var handle35 = dataView(memory0).getInt32(arg0 + 60, true);
      var rep36 = handleTable16[(handle35 << 1) + 1] & ~T_FLAG;
      var rsc34 = captureTable16.get(rep36);
      if (!rsc34) {
        rsc34 = Object.create(GpuQuerySet.prototype);
        Object.defineProperty(rsc34, symbolRscHandle, { writable: true, value: handle35});
        Object.defineProperty(rsc34, symbolRscRep, { writable: true, value: rep36});
      }
      curResourceBorrows.push(rsc34);
      variant37 = rsc34;
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  let variant43;
  switch (dataView(memory0).getUint8(arg0 + 64, true)) {
    case 0: {
      variant43 = undefined;
      break;
    }
    case 1: {
      var handle39 = dataView(memory0).getInt32(arg0 + 68, true);
      var rep40 = handleTable16[(handle39 << 1) + 1] & ~T_FLAG;
      var rsc38 = captureTable16.get(rep40);
      if (!rsc38) {
        rsc38 = Object.create(GpuQuerySet.prototype);
        Object.defineProperty(rsc38, symbolRscHandle, { writable: true, value: handle39});
        Object.defineProperty(rsc38, symbolRscRep, { writable: true, value: rep40});
      }
      curResourceBorrows.push(rsc38);
      let variant41;
      switch (dataView(memory0).getUint8(arg0 + 72, true)) {
        case 0: {
          variant41 = undefined;
          break;
        }
        case 1: {
          variant41 = dataView(memory0).getInt32(arg0 + 76, true) >>> 0;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      let variant42;
      switch (dataView(memory0).getUint8(arg0 + 80, true)) {
        case 0: {
          variant42 = undefined;
          break;
        }
        case 1: {
          variant42 = dataView(memory0).getInt32(arg0 + 84, true) >>> 0;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      variant43 = {
        querySet: rsc38,
        beginningOfPassWriteIndex: variant41,
        endOfPassWriteIndex: variant42,
      };
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  let variant44;
  switch (dataView(memory0).getUint8(arg0 + 88, true)) {
    case 0: {
      variant44 = undefined;
      break;
    }
    case 1: {
      variant44 = BigInt.asUintN(64, dataView(memory0).getBigInt64(arg0 + 96, true));
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  let variant46;
  switch (dataView(memory0).getUint8(arg0 + 104, true)) {
    case 0: {
      variant46 = undefined;
      break;
    }
    case 1: {
      var ptr45 = dataView(memory0).getUint32(arg0 + 108, true);
      var len45 = dataView(memory0).getUint32(arg0 + 112, true);
      var result45 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr45, len45));
      variant46 = result45;
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-command-encoder.begin-render-pass"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]gpu-command-encoder.begin-render-pass');
  const ret = rsc0.beginRenderPass({
    colorAttachments: result15,
    depthStencilAttachment: variant33,
    occlusionQuerySet: variant37,
    timestampWrites: variant43,
    maxDrawCount: variant44,
    label: variant46,
  });
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-command-encoder.begin-render-pass"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  if (!(ret instanceof GpuRenderPassEncoder)) {
    throw new TypeError('Resource error: Not a valid "GpuRenderPassEncoder" resource.');
  }
  var handle47 = ret[symbolRscHandle];
  if (!handle47) {
    const rep = ret[symbolRscRep] || ++captureCnt17;
    captureTable17.set(rep, ret);
    handle47 = rscTableCreateOwn(handleTable17, rep);
  }
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-command-encoder.begin-render-pass"][Instruction::Return]', {
    funcName: '[method]gpu-command-encoder.begin-render-pass',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  return handle47;
}

const handleTable18 = [T_FLAG, 0];
const captureTable18= new Map();
let captureCnt18 = 0;
handleTables[18] = handleTable18;

function trampoline43(arg0, arg1, arg2, arg3, arg4) {
  var handle1 = arg0;
  var rep2 = handleTable13[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable13.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(GpuCommandEncoder.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  let variant5;
  switch (arg1) {
    case 0: {
      variant5 = undefined;
      break;
    }
    case 1: {
      let variant4;
      switch (arg2) {
        case 0: {
          variant4 = undefined;
          break;
        }
        case 1: {
          var ptr3 = arg3;
          var len3 = arg4;
          var result3 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr3, len3));
          variant4 = result3;
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for option');
        }
      }
      variant5 = {
        label: variant4,
      };
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-command-encoder.finish"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]gpu-command-encoder.finish');
  const ret = rsc0.finish(variant5);
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-command-encoder.finish"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  if (!(ret instanceof GpuCommandBuffer)) {
    throw new TypeError('Resource error: Not a valid "GpuCommandBuffer" resource.');
  }
  var handle6 = ret[symbolRscHandle];
  if (!handle6) {
    const rep = ret[symbolRscRep] || ++captureCnt18;
    captureTable18.set(rep, ret);
    handle6 = rscTableCreateOwn(handleTable18, rep);
  }
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-command-encoder.finish"][Instruction::Return]', {
    funcName: '[method]gpu-command-encoder.finish',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  return handle6;
}


function trampoline44(arg0, arg1, arg2) {
  var handle1 = arg0;
  var rep2 = handleTable7[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable7.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(GpuQueue.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  var len6 = arg2;
  var base6 = arg1;
  var result6 = [];
  for (let i = 0; i < len6; i++) {
    const base = base6 + i * 4;
    var handle4 = dataView(memory0).getInt32(base + 0, true);
    var rep5 = handleTable18[(handle4 << 1) + 1] & ~T_FLAG;
    var rsc3 = captureTable18.get(rep5);
    if (!rsc3) {
      rsc3 = Object.create(GpuCommandBuffer.prototype);
      Object.defineProperty(rsc3, symbolRscHandle, { writable: true, value: handle4});
      Object.defineProperty(rsc3, symbolRscRep, { writable: true, value: rep5});
    }
    curResourceBorrows.push(rsc3);
    result6.push(rsc3);
  }
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-queue.submit"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]gpu-queue.submit');
  rsc0.submit(result6);
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-queue.submit"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  _debugLog('[iface="wasi:webgpu/webgpu@0.0.1", function="[method]gpu-queue.submit"][Instruction::Return]', {
    funcName: '[method]gpu-queue.submit',
    paramCount: 0,
    async: false,
    postReturn: false
  });
}

const handleTable20 = [T_FLAG, 0];
const captureTable20= new Map();
let captureCnt20 = 0;
handleTables[20] = handleTable20;

const trampoline45 = new WebAssembly.Suspending(async function(arg0, arg1, arg2, arg3) {
  var handle1 = arg0;
  var rep2 = handleTable21[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable21.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(OutputStream.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  var ptr3 = arg1;
  var len3 = arg2;
  var result3 = new Uint8Array(memory0.buffer.slice(ptr3, ptr3 + len3 * 1));
  _debugLog('[iface="wasi:io/streams@0.2.0", function="[method]output-stream.blocking-write-and-flush"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]output-stream.blocking-write-and-flush');
  let ret;
  try {
    ret = { tag: 'ok', val: await rsc0.blockingWriteAndFlush(result3)};
  } catch (e) {
    ret = { tag: 'err', val: getErrorPayload(e) };
  }
  _debugLog('[iface="wasi:io/streams@0.2.0", function="[method]output-stream.blocking-write-and-flush"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  var variant6 = ret;
  switch (variant6.tag) {
    case 'ok': {
      const e = variant6.val;
      dataView(memory0).setInt8(arg3 + 0, 0, true);
      break;
    }
    case 'err': {
      const e = variant6.val;
      dataView(memory0).setInt8(arg3 + 0, 1, true);
      var variant5 = e;
      switch (variant5.tag) {
        case 'last-operation-failed': {
          const e = variant5.val;
          dataView(memory0).setInt8(arg3 + 4, 0, true);
          if (!(e instanceof Error$1)) {
            throw new TypeError('Resource error: Not a valid "Error" resource.');
          }
          var handle4 = e[symbolRscHandle];
          if (!handle4) {
            const rep = e[symbolRscRep] || ++captureCnt20;
            captureTable20.set(rep, e);
            handle4 = rscTableCreateOwn(handleTable20, rep);
          }
          dataView(memory0).setInt32(arg3 + 8, handle4, true);
          break;
        }
        case 'closed': {
          dataView(memory0).setInt8(arg3 + 4, 1, true);
          break;
        }
        default: {
          throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant5.tag)}\` (received \`${variant5}\`) specified for \`StreamError\``);
        }
      }
      break;
    }
    default: {
      throw new TypeError('invalid variant specified for result');
    }
  }
  _debugLog('[iface="wasi:io/streams@0.2.0", function="[method]output-stream.blocking-write-and-flush"][Instruction::Return]', {
    funcName: '[method]output-stream.blocking-write-and-flush',
    paramCount: 0,
    async: false,
    postReturn: false
  });
}
);

function trampoline46(arg0, arg1) {
  var handle1 = arg0;
  var rep2 = handleTable19[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable19.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Surface.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.get-pointer-up"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]surface.get-pointer-up');
  const ret = rsc0.getPointerUp();
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.get-pointer-up"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  var variant4 = ret;
  if (variant4 === null || variant4=== undefined) {
    dataView(memory0).setInt8(arg1 + 0, 0, true);
  } else {
    const e = variant4;
    dataView(memory0).setInt8(arg1 + 0, 1, true);
    var {x: v3_0, y: v3_1 } = e;
    dataView(memory0).setFloat64(arg1 + 8, +v3_0, true);
    dataView(memory0).setFloat64(arg1 + 16, +v3_1, true);
  }
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.get-pointer-up"][Instruction::Return]', {
    funcName: '[method]surface.get-pointer-up',
    paramCount: 0,
    async: false,
    postReturn: false
  });
}


function trampoline47(arg0, arg1) {
  var handle1 = arg0;
  var rep2 = handleTable19[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable19.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Surface.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.get-pointer-down"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]surface.get-pointer-down');
  const ret = rsc0.getPointerDown();
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.get-pointer-down"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  var variant4 = ret;
  if (variant4 === null || variant4=== undefined) {
    dataView(memory0).setInt8(arg1 + 0, 0, true);
  } else {
    const e = variant4;
    dataView(memory0).setInt8(arg1 + 0, 1, true);
    var {x: v3_0, y: v3_1 } = e;
    dataView(memory0).setFloat64(arg1 + 8, +v3_0, true);
    dataView(memory0).setFloat64(arg1 + 16, +v3_1, true);
  }
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.get-pointer-down"][Instruction::Return]', {
    funcName: '[method]surface.get-pointer-down',
    paramCount: 0,
    async: false,
    postReturn: false
  });
}


function trampoline48(arg0, arg1) {
  var handle1 = arg0;
  var rep2 = handleTable19[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable19.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Surface.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.get-pointer-move"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]surface.get-pointer-move');
  const ret = rsc0.getPointerMove();
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.get-pointer-move"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  var variant4 = ret;
  if (variant4 === null || variant4=== undefined) {
    dataView(memory0).setInt8(arg1 + 0, 0, true);
  } else {
    const e = variant4;
    dataView(memory0).setInt8(arg1 + 0, 1, true);
    var {x: v3_0, y: v3_1 } = e;
    dataView(memory0).setFloat64(arg1 + 8, +v3_0, true);
    dataView(memory0).setFloat64(arg1 + 16, +v3_1, true);
  }
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.get-pointer-move"][Instruction::Return]', {
    funcName: '[method]surface.get-pointer-move',
    paramCount: 0,
    async: false,
    postReturn: false
  });
}


function trampoline49(arg0, arg1) {
  var handle1 = arg0;
  var rep2 = handleTable19[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable19.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Surface.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.get-key-up"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]surface.get-key-up');
  const ret = rsc0.getKeyUp();
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.get-key-up"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  var variant8 = ret;
  if (variant8 === null || variant8=== undefined) {
    dataView(memory0).setInt8(arg1 + 0, 0, true);
  } else {
    const e = variant8;
    dataView(memory0).setInt8(arg1 + 0, 1, true);
    var {key: v3_0, text: v3_1, altKey: v3_2, ctrlKey: v3_3, metaKey: v3_4, shiftKey: v3_5 } = e;
    var variant5 = v3_0;
    if (variant5 === null || variant5=== undefined) {
      dataView(memory0).setInt8(arg1 + 4, 0, true);
    } else {
      const e = variant5;
      dataView(memory0).setInt8(arg1 + 4, 1, true);
      var val4 = e;
      let enum4;
      switch (val4) {
        case 'backquote': {
          enum4 = 0;
          break;
        }
        case 'backslash': {
          enum4 = 1;
          break;
        }
        case 'bracket-left': {
          enum4 = 2;
          break;
        }
        case 'bracket-right': {
          enum4 = 3;
          break;
        }
        case 'comma': {
          enum4 = 4;
          break;
        }
        case 'digit0': {
          enum4 = 5;
          break;
        }
        case 'digit1': {
          enum4 = 6;
          break;
        }
        case 'digit2': {
          enum4 = 7;
          break;
        }
        case 'digit3': {
          enum4 = 8;
          break;
        }
        case 'digit4': {
          enum4 = 9;
          break;
        }
        case 'digit5': {
          enum4 = 10;
          break;
        }
        case 'digit6': {
          enum4 = 11;
          break;
        }
        case 'digit7': {
          enum4 = 12;
          break;
        }
        case 'digit8': {
          enum4 = 13;
          break;
        }
        case 'digit9': {
          enum4 = 14;
          break;
        }
        case 'equal': {
          enum4 = 15;
          break;
        }
        case 'intl-backslash': {
          enum4 = 16;
          break;
        }
        case 'intl-ro': {
          enum4 = 17;
          break;
        }
        case 'intl-yen': {
          enum4 = 18;
          break;
        }
        case 'key-a': {
          enum4 = 19;
          break;
        }
        case 'key-b': {
          enum4 = 20;
          break;
        }
        case 'key-c': {
          enum4 = 21;
          break;
        }
        case 'key-d': {
          enum4 = 22;
          break;
        }
        case 'key-e': {
          enum4 = 23;
          break;
        }
        case 'key-f': {
          enum4 = 24;
          break;
        }
        case 'key-g': {
          enum4 = 25;
          break;
        }
        case 'key-h': {
          enum4 = 26;
          break;
        }
        case 'key-i': {
          enum4 = 27;
          break;
        }
        case 'key-j': {
          enum4 = 28;
          break;
        }
        case 'key-k': {
          enum4 = 29;
          break;
        }
        case 'key-l': {
          enum4 = 30;
          break;
        }
        case 'key-m': {
          enum4 = 31;
          break;
        }
        case 'key-n': {
          enum4 = 32;
          break;
        }
        case 'key-o': {
          enum4 = 33;
          break;
        }
        case 'key-p': {
          enum4 = 34;
          break;
        }
        case 'key-q': {
          enum4 = 35;
          break;
        }
        case 'key-r': {
          enum4 = 36;
          break;
        }
        case 'key-s': {
          enum4 = 37;
          break;
        }
        case 'key-t': {
          enum4 = 38;
          break;
        }
        case 'key-u': {
          enum4 = 39;
          break;
        }
        case 'key-v': {
          enum4 = 40;
          break;
        }
        case 'key-w': {
          enum4 = 41;
          break;
        }
        case 'key-x': {
          enum4 = 42;
          break;
        }
        case 'key-y': {
          enum4 = 43;
          break;
        }
        case 'key-z': {
          enum4 = 44;
          break;
        }
        case 'minus': {
          enum4 = 45;
          break;
        }
        case 'period': {
          enum4 = 46;
          break;
        }
        case 'quote': {
          enum4 = 47;
          break;
        }
        case 'semicolon': {
          enum4 = 48;
          break;
        }
        case 'slash': {
          enum4 = 49;
          break;
        }
        case 'alt-left': {
          enum4 = 50;
          break;
        }
        case 'alt-right': {
          enum4 = 51;
          break;
        }
        case 'backspace': {
          enum4 = 52;
          break;
        }
        case 'caps-lock': {
          enum4 = 53;
          break;
        }
        case 'context-menu': {
          enum4 = 54;
          break;
        }
        case 'control-left': {
          enum4 = 55;
          break;
        }
        case 'control-right': {
          enum4 = 56;
          break;
        }
        case 'enter': {
          enum4 = 57;
          break;
        }
        case 'meta-left': {
          enum4 = 58;
          break;
        }
        case 'meta-right': {
          enum4 = 59;
          break;
        }
        case 'shift-left': {
          enum4 = 60;
          break;
        }
        case 'shift-right': {
          enum4 = 61;
          break;
        }
        case 'space': {
          enum4 = 62;
          break;
        }
        case 'tab': {
          enum4 = 63;
          break;
        }
        case 'convert': {
          enum4 = 64;
          break;
        }
        case 'kana-mode': {
          enum4 = 65;
          break;
        }
        case 'lang1': {
          enum4 = 66;
          break;
        }
        case 'lang2': {
          enum4 = 67;
          break;
        }
        case 'lang3': {
          enum4 = 68;
          break;
        }
        case 'lang4': {
          enum4 = 69;
          break;
        }
        case 'lang5': {
          enum4 = 70;
          break;
        }
        case 'non-convert': {
          enum4 = 71;
          break;
        }
        case 'delete': {
          enum4 = 72;
          break;
        }
        case 'end': {
          enum4 = 73;
          break;
        }
        case 'help': {
          enum4 = 74;
          break;
        }
        case 'home': {
          enum4 = 75;
          break;
        }
        case 'insert': {
          enum4 = 76;
          break;
        }
        case 'page-down': {
          enum4 = 77;
          break;
        }
        case 'page-up': {
          enum4 = 78;
          break;
        }
        case 'arrow-down': {
          enum4 = 79;
          break;
        }
        case 'arrow-left': {
          enum4 = 80;
          break;
        }
        case 'arrow-right': {
          enum4 = 81;
          break;
        }
        case 'arrow-up': {
          enum4 = 82;
          break;
        }
        case 'num-lock': {
          enum4 = 83;
          break;
        }
        case 'numpad0': {
          enum4 = 84;
          break;
        }
        case 'numpad1': {
          enum4 = 85;
          break;
        }
        case 'numpad2': {
          enum4 = 86;
          break;
        }
        case 'numpad3': {
          enum4 = 87;
          break;
        }
        case 'numpad4': {
          enum4 = 88;
          break;
        }
        case 'numpad5': {
          enum4 = 89;
          break;
        }
        case 'numpad6': {
          enum4 = 90;
          break;
        }
        case 'numpad7': {
          enum4 = 91;
          break;
        }
        case 'numpad8': {
          enum4 = 92;
          break;
        }
        case 'numpad9': {
          enum4 = 93;
          break;
        }
        case 'numpad-add': {
          enum4 = 94;
          break;
        }
        case 'numpad-backspace': {
          enum4 = 95;
          break;
        }
        case 'numpad-clear': {
          enum4 = 96;
          break;
        }
        case 'numpad-clear-entry': {
          enum4 = 97;
          break;
        }
        case 'numpad-comma': {
          enum4 = 98;
          break;
        }
        case 'numpad-decimal': {
          enum4 = 99;
          break;
        }
        case 'numpad-divide': {
          enum4 = 100;
          break;
        }
        case 'numpad-enter': {
          enum4 = 101;
          break;
        }
        case 'numpad-equal': {
          enum4 = 102;
          break;
        }
        case 'numpad-hash': {
          enum4 = 103;
          break;
        }
        case 'numpad-memory-add': {
          enum4 = 104;
          break;
        }
        case 'numpad-memory-clear': {
          enum4 = 105;
          break;
        }
        case 'numpad-memory-recall': {
          enum4 = 106;
          break;
        }
        case 'numpad-memory-store': {
          enum4 = 107;
          break;
        }
        case 'numpad-memory-subtract': {
          enum4 = 108;
          break;
        }
        case 'numpad-multiply': {
          enum4 = 109;
          break;
        }
        case 'numpad-paren-left': {
          enum4 = 110;
          break;
        }
        case 'numpad-paren-right': {
          enum4 = 111;
          break;
        }
        case 'numpad-star': {
          enum4 = 112;
          break;
        }
        case 'numpad-subtract': {
          enum4 = 113;
          break;
        }
        case 'escape': {
          enum4 = 114;
          break;
        }
        case 'f1': {
          enum4 = 115;
          break;
        }
        case 'f2': {
          enum4 = 116;
          break;
        }
        case 'f3': {
          enum4 = 117;
          break;
        }
        case 'f4': {
          enum4 = 118;
          break;
        }
        case 'f5': {
          enum4 = 119;
          break;
        }
        case 'f6': {
          enum4 = 120;
          break;
        }
        case 'f7': {
          enum4 = 121;
          break;
        }
        case 'f8': {
          enum4 = 122;
          break;
        }
        case 'f9': {
          enum4 = 123;
          break;
        }
        case 'f10': {
          enum4 = 124;
          break;
        }
        case 'f11': {
          enum4 = 125;
          break;
        }
        case 'f12': {
          enum4 = 126;
          break;
        }
        case 'fn': {
          enum4 = 127;
          break;
        }
        case 'fn-lock': {
          enum4 = 128;
          break;
        }
        case 'print-screen': {
          enum4 = 129;
          break;
        }
        case 'scroll-lock': {
          enum4 = 130;
          break;
        }
        case 'pause': {
          enum4 = 131;
          break;
        }
        case 'browser-back': {
          enum4 = 132;
          break;
        }
        case 'browser-favorites': {
          enum4 = 133;
          break;
        }
        case 'browser-forward': {
          enum4 = 134;
          break;
        }
        case 'browser-home': {
          enum4 = 135;
          break;
        }
        case 'browser-refresh': {
          enum4 = 136;
          break;
        }
        case 'browser-search': {
          enum4 = 137;
          break;
        }
        case 'browser-stop': {
          enum4 = 138;
          break;
        }
        case 'eject': {
          enum4 = 139;
          break;
        }
        case 'launch-app1': {
          enum4 = 140;
          break;
        }
        case 'launch-app2': {
          enum4 = 141;
          break;
        }
        case 'launch-mail': {
          enum4 = 142;
          break;
        }
        case 'media-play-pause': {
          enum4 = 143;
          break;
        }
        case 'media-select': {
          enum4 = 144;
          break;
        }
        case 'media-stop': {
          enum4 = 145;
          break;
        }
        case 'media-track-next': {
          enum4 = 146;
          break;
        }
        case 'media-track-previous': {
          enum4 = 147;
          break;
        }
        case 'power': {
          enum4 = 148;
          break;
        }
        case 'sleep': {
          enum4 = 149;
          break;
        }
        case 'audio-volume-down': {
          enum4 = 150;
          break;
        }
        case 'audio-volume-mute': {
          enum4 = 151;
          break;
        }
        case 'audio-volume-up': {
          enum4 = 152;
          break;
        }
        case 'wake-up': {
          enum4 = 153;
          break;
        }
        case 'hyper': {
          enum4 = 154;
          break;
        }
        case 'super': {
          enum4 = 155;
          break;
        }
        case 'turbo': {
          enum4 = 156;
          break;
        }
        case 'abort': {
          enum4 = 157;
          break;
        }
        case 'resume': {
          enum4 = 158;
          break;
        }
        case 'suspend': {
          enum4 = 159;
          break;
        }
        case 'again': {
          enum4 = 160;
          break;
        }
        case 'copy': {
          enum4 = 161;
          break;
        }
        case 'cut': {
          enum4 = 162;
          break;
        }
        case 'find': {
          enum4 = 163;
          break;
        }
        case 'open': {
          enum4 = 164;
          break;
        }
        case 'paste': {
          enum4 = 165;
          break;
        }
        case 'props': {
          enum4 = 166;
          break;
        }
        case 'select': {
          enum4 = 167;
          break;
        }
        case 'undo': {
          enum4 = 168;
          break;
        }
        case 'hiragana': {
          enum4 = 169;
          break;
        }
        case 'katakana': {
          enum4 = 170;
          break;
        }
        default: {
          if ((e) instanceof Error) {
            console.error(e);
          }
          
          throw new TypeError(`"${val4}" is not one of the cases of key`);
        }
      }
      dataView(memory0).setInt8(arg1 + 5, enum4, true);
    }
    var variant7 = v3_1;
    if (variant7 === null || variant7=== undefined) {
      dataView(memory0).setInt8(arg1 + 8, 0, true);
    } else {
      const e = variant7;
      dataView(memory0).setInt8(arg1 + 8, 1, true);
      var ptr6 = utf8Encode(e, realloc0, memory0);
      var len6 = utf8EncodedLen;
      dataView(memory0).setUint32(arg1 + 16, len6, true);
      dataView(memory0).setUint32(arg1 + 12, ptr6, true);
    }
    dataView(memory0).setInt8(arg1 + 20, v3_2 ? 1 : 0, true);
    dataView(memory0).setInt8(arg1 + 21, v3_3 ? 1 : 0, true);
    dataView(memory0).setInt8(arg1 + 22, v3_4 ? 1 : 0, true);
    dataView(memory0).setInt8(arg1 + 23, v3_5 ? 1 : 0, true);
  }
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.get-key-up"][Instruction::Return]', {
    funcName: '[method]surface.get-key-up',
    paramCount: 0,
    async: false,
    postReturn: false
  });
}


function trampoline50(arg0, arg1) {
  var handle1 = arg0;
  var rep2 = handleTable19[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable19.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Surface.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.get-key-down"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]surface.get-key-down');
  const ret = rsc0.getKeyDown();
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.get-key-down"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  var variant8 = ret;
  if (variant8 === null || variant8=== undefined) {
    dataView(memory0).setInt8(arg1 + 0, 0, true);
  } else {
    const e = variant8;
    dataView(memory0).setInt8(arg1 + 0, 1, true);
    var {key: v3_0, text: v3_1, altKey: v3_2, ctrlKey: v3_3, metaKey: v3_4, shiftKey: v3_5 } = e;
    var variant5 = v3_0;
    if (variant5 === null || variant5=== undefined) {
      dataView(memory0).setInt8(arg1 + 4, 0, true);
    } else {
      const e = variant5;
      dataView(memory0).setInt8(arg1 + 4, 1, true);
      var val4 = e;
      let enum4;
      switch (val4) {
        case 'backquote': {
          enum4 = 0;
          break;
        }
        case 'backslash': {
          enum4 = 1;
          break;
        }
        case 'bracket-left': {
          enum4 = 2;
          break;
        }
        case 'bracket-right': {
          enum4 = 3;
          break;
        }
        case 'comma': {
          enum4 = 4;
          break;
        }
        case 'digit0': {
          enum4 = 5;
          break;
        }
        case 'digit1': {
          enum4 = 6;
          break;
        }
        case 'digit2': {
          enum4 = 7;
          break;
        }
        case 'digit3': {
          enum4 = 8;
          break;
        }
        case 'digit4': {
          enum4 = 9;
          break;
        }
        case 'digit5': {
          enum4 = 10;
          break;
        }
        case 'digit6': {
          enum4 = 11;
          break;
        }
        case 'digit7': {
          enum4 = 12;
          break;
        }
        case 'digit8': {
          enum4 = 13;
          break;
        }
        case 'digit9': {
          enum4 = 14;
          break;
        }
        case 'equal': {
          enum4 = 15;
          break;
        }
        case 'intl-backslash': {
          enum4 = 16;
          break;
        }
        case 'intl-ro': {
          enum4 = 17;
          break;
        }
        case 'intl-yen': {
          enum4 = 18;
          break;
        }
        case 'key-a': {
          enum4 = 19;
          break;
        }
        case 'key-b': {
          enum4 = 20;
          break;
        }
        case 'key-c': {
          enum4 = 21;
          break;
        }
        case 'key-d': {
          enum4 = 22;
          break;
        }
        case 'key-e': {
          enum4 = 23;
          break;
        }
        case 'key-f': {
          enum4 = 24;
          break;
        }
        case 'key-g': {
          enum4 = 25;
          break;
        }
        case 'key-h': {
          enum4 = 26;
          break;
        }
        case 'key-i': {
          enum4 = 27;
          break;
        }
        case 'key-j': {
          enum4 = 28;
          break;
        }
        case 'key-k': {
          enum4 = 29;
          break;
        }
        case 'key-l': {
          enum4 = 30;
          break;
        }
        case 'key-m': {
          enum4 = 31;
          break;
        }
        case 'key-n': {
          enum4 = 32;
          break;
        }
        case 'key-o': {
          enum4 = 33;
          break;
        }
        case 'key-p': {
          enum4 = 34;
          break;
        }
        case 'key-q': {
          enum4 = 35;
          break;
        }
        case 'key-r': {
          enum4 = 36;
          break;
        }
        case 'key-s': {
          enum4 = 37;
          break;
        }
        case 'key-t': {
          enum4 = 38;
          break;
        }
        case 'key-u': {
          enum4 = 39;
          break;
        }
        case 'key-v': {
          enum4 = 40;
          break;
        }
        case 'key-w': {
          enum4 = 41;
          break;
        }
        case 'key-x': {
          enum4 = 42;
          break;
        }
        case 'key-y': {
          enum4 = 43;
          break;
        }
        case 'key-z': {
          enum4 = 44;
          break;
        }
        case 'minus': {
          enum4 = 45;
          break;
        }
        case 'period': {
          enum4 = 46;
          break;
        }
        case 'quote': {
          enum4 = 47;
          break;
        }
        case 'semicolon': {
          enum4 = 48;
          break;
        }
        case 'slash': {
          enum4 = 49;
          break;
        }
        case 'alt-left': {
          enum4 = 50;
          break;
        }
        case 'alt-right': {
          enum4 = 51;
          break;
        }
        case 'backspace': {
          enum4 = 52;
          break;
        }
        case 'caps-lock': {
          enum4 = 53;
          break;
        }
        case 'context-menu': {
          enum4 = 54;
          break;
        }
        case 'control-left': {
          enum4 = 55;
          break;
        }
        case 'control-right': {
          enum4 = 56;
          break;
        }
        case 'enter': {
          enum4 = 57;
          break;
        }
        case 'meta-left': {
          enum4 = 58;
          break;
        }
        case 'meta-right': {
          enum4 = 59;
          break;
        }
        case 'shift-left': {
          enum4 = 60;
          break;
        }
        case 'shift-right': {
          enum4 = 61;
          break;
        }
        case 'space': {
          enum4 = 62;
          break;
        }
        case 'tab': {
          enum4 = 63;
          break;
        }
        case 'convert': {
          enum4 = 64;
          break;
        }
        case 'kana-mode': {
          enum4 = 65;
          break;
        }
        case 'lang1': {
          enum4 = 66;
          break;
        }
        case 'lang2': {
          enum4 = 67;
          break;
        }
        case 'lang3': {
          enum4 = 68;
          break;
        }
        case 'lang4': {
          enum4 = 69;
          break;
        }
        case 'lang5': {
          enum4 = 70;
          break;
        }
        case 'non-convert': {
          enum4 = 71;
          break;
        }
        case 'delete': {
          enum4 = 72;
          break;
        }
        case 'end': {
          enum4 = 73;
          break;
        }
        case 'help': {
          enum4 = 74;
          break;
        }
        case 'home': {
          enum4 = 75;
          break;
        }
        case 'insert': {
          enum4 = 76;
          break;
        }
        case 'page-down': {
          enum4 = 77;
          break;
        }
        case 'page-up': {
          enum4 = 78;
          break;
        }
        case 'arrow-down': {
          enum4 = 79;
          break;
        }
        case 'arrow-left': {
          enum4 = 80;
          break;
        }
        case 'arrow-right': {
          enum4 = 81;
          break;
        }
        case 'arrow-up': {
          enum4 = 82;
          break;
        }
        case 'num-lock': {
          enum4 = 83;
          break;
        }
        case 'numpad0': {
          enum4 = 84;
          break;
        }
        case 'numpad1': {
          enum4 = 85;
          break;
        }
        case 'numpad2': {
          enum4 = 86;
          break;
        }
        case 'numpad3': {
          enum4 = 87;
          break;
        }
        case 'numpad4': {
          enum4 = 88;
          break;
        }
        case 'numpad5': {
          enum4 = 89;
          break;
        }
        case 'numpad6': {
          enum4 = 90;
          break;
        }
        case 'numpad7': {
          enum4 = 91;
          break;
        }
        case 'numpad8': {
          enum4 = 92;
          break;
        }
        case 'numpad9': {
          enum4 = 93;
          break;
        }
        case 'numpad-add': {
          enum4 = 94;
          break;
        }
        case 'numpad-backspace': {
          enum4 = 95;
          break;
        }
        case 'numpad-clear': {
          enum4 = 96;
          break;
        }
        case 'numpad-clear-entry': {
          enum4 = 97;
          break;
        }
        case 'numpad-comma': {
          enum4 = 98;
          break;
        }
        case 'numpad-decimal': {
          enum4 = 99;
          break;
        }
        case 'numpad-divide': {
          enum4 = 100;
          break;
        }
        case 'numpad-enter': {
          enum4 = 101;
          break;
        }
        case 'numpad-equal': {
          enum4 = 102;
          break;
        }
        case 'numpad-hash': {
          enum4 = 103;
          break;
        }
        case 'numpad-memory-add': {
          enum4 = 104;
          break;
        }
        case 'numpad-memory-clear': {
          enum4 = 105;
          break;
        }
        case 'numpad-memory-recall': {
          enum4 = 106;
          break;
        }
        case 'numpad-memory-store': {
          enum4 = 107;
          break;
        }
        case 'numpad-memory-subtract': {
          enum4 = 108;
          break;
        }
        case 'numpad-multiply': {
          enum4 = 109;
          break;
        }
        case 'numpad-paren-left': {
          enum4 = 110;
          break;
        }
        case 'numpad-paren-right': {
          enum4 = 111;
          break;
        }
        case 'numpad-star': {
          enum4 = 112;
          break;
        }
        case 'numpad-subtract': {
          enum4 = 113;
          break;
        }
        case 'escape': {
          enum4 = 114;
          break;
        }
        case 'f1': {
          enum4 = 115;
          break;
        }
        case 'f2': {
          enum4 = 116;
          break;
        }
        case 'f3': {
          enum4 = 117;
          break;
        }
        case 'f4': {
          enum4 = 118;
          break;
        }
        case 'f5': {
          enum4 = 119;
          break;
        }
        case 'f6': {
          enum4 = 120;
          break;
        }
        case 'f7': {
          enum4 = 121;
          break;
        }
        case 'f8': {
          enum4 = 122;
          break;
        }
        case 'f9': {
          enum4 = 123;
          break;
        }
        case 'f10': {
          enum4 = 124;
          break;
        }
        case 'f11': {
          enum4 = 125;
          break;
        }
        case 'f12': {
          enum4 = 126;
          break;
        }
        case 'fn': {
          enum4 = 127;
          break;
        }
        case 'fn-lock': {
          enum4 = 128;
          break;
        }
        case 'print-screen': {
          enum4 = 129;
          break;
        }
        case 'scroll-lock': {
          enum4 = 130;
          break;
        }
        case 'pause': {
          enum4 = 131;
          break;
        }
        case 'browser-back': {
          enum4 = 132;
          break;
        }
        case 'browser-favorites': {
          enum4 = 133;
          break;
        }
        case 'browser-forward': {
          enum4 = 134;
          break;
        }
        case 'browser-home': {
          enum4 = 135;
          break;
        }
        case 'browser-refresh': {
          enum4 = 136;
          break;
        }
        case 'browser-search': {
          enum4 = 137;
          break;
        }
        case 'browser-stop': {
          enum4 = 138;
          break;
        }
        case 'eject': {
          enum4 = 139;
          break;
        }
        case 'launch-app1': {
          enum4 = 140;
          break;
        }
        case 'launch-app2': {
          enum4 = 141;
          break;
        }
        case 'launch-mail': {
          enum4 = 142;
          break;
        }
        case 'media-play-pause': {
          enum4 = 143;
          break;
        }
        case 'media-select': {
          enum4 = 144;
          break;
        }
        case 'media-stop': {
          enum4 = 145;
          break;
        }
        case 'media-track-next': {
          enum4 = 146;
          break;
        }
        case 'media-track-previous': {
          enum4 = 147;
          break;
        }
        case 'power': {
          enum4 = 148;
          break;
        }
        case 'sleep': {
          enum4 = 149;
          break;
        }
        case 'audio-volume-down': {
          enum4 = 150;
          break;
        }
        case 'audio-volume-mute': {
          enum4 = 151;
          break;
        }
        case 'audio-volume-up': {
          enum4 = 152;
          break;
        }
        case 'wake-up': {
          enum4 = 153;
          break;
        }
        case 'hyper': {
          enum4 = 154;
          break;
        }
        case 'super': {
          enum4 = 155;
          break;
        }
        case 'turbo': {
          enum4 = 156;
          break;
        }
        case 'abort': {
          enum4 = 157;
          break;
        }
        case 'resume': {
          enum4 = 158;
          break;
        }
        case 'suspend': {
          enum4 = 159;
          break;
        }
        case 'again': {
          enum4 = 160;
          break;
        }
        case 'copy': {
          enum4 = 161;
          break;
        }
        case 'cut': {
          enum4 = 162;
          break;
        }
        case 'find': {
          enum4 = 163;
          break;
        }
        case 'open': {
          enum4 = 164;
          break;
        }
        case 'paste': {
          enum4 = 165;
          break;
        }
        case 'props': {
          enum4 = 166;
          break;
        }
        case 'select': {
          enum4 = 167;
          break;
        }
        case 'undo': {
          enum4 = 168;
          break;
        }
        case 'hiragana': {
          enum4 = 169;
          break;
        }
        case 'katakana': {
          enum4 = 170;
          break;
        }
        default: {
          if ((e) instanceof Error) {
            console.error(e);
          }
          
          throw new TypeError(`"${val4}" is not one of the cases of key`);
        }
      }
      dataView(memory0).setInt8(arg1 + 5, enum4, true);
    }
    var variant7 = v3_1;
    if (variant7 === null || variant7=== undefined) {
      dataView(memory0).setInt8(arg1 + 8, 0, true);
    } else {
      const e = variant7;
      dataView(memory0).setInt8(arg1 + 8, 1, true);
      var ptr6 = utf8Encode(e, realloc0, memory0);
      var len6 = utf8EncodedLen;
      dataView(memory0).setUint32(arg1 + 16, len6, true);
      dataView(memory0).setUint32(arg1 + 12, ptr6, true);
    }
    dataView(memory0).setInt8(arg1 + 20, v3_2 ? 1 : 0, true);
    dataView(memory0).setInt8(arg1 + 21, v3_3 ? 1 : 0, true);
    dataView(memory0).setInt8(arg1 + 22, v3_4 ? 1 : 0, true);
    dataView(memory0).setInt8(arg1 + 23, v3_5 ? 1 : 0, true);
  }
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.get-key-down"][Instruction::Return]', {
    funcName: '[method]surface.get-key-down',
    paramCount: 0,
    async: false,
    postReturn: false
  });
}


function trampoline51(arg0, arg1) {
  var handle1 = arg0;
  var rep2 = handleTable19[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable19.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Surface.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.get-resize"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]surface.get-resize');
  const ret = rsc0.getResize();
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.get-resize"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  var variant4 = ret;
  if (variant4 === null || variant4=== undefined) {
    dataView(memory0).setInt8(arg1 + 0, 0, true);
  } else {
    const e = variant4;
    dataView(memory0).setInt8(arg1 + 0, 1, true);
    var {height: v3_0, width: v3_1 } = e;
    dataView(memory0).setInt32(arg1 + 4, toUint32(v3_0), true);
    dataView(memory0).setInt32(arg1 + 8, toUint32(v3_1), true);
  }
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.get-resize"][Instruction::Return]', {
    funcName: '[method]surface.get-resize',
    paramCount: 0,
    async: false,
    postReturn: false
  });
}


function trampoline52(arg0, arg1) {
  var handle1 = arg0;
  var rep2 = handleTable19[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable19.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Surface.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.get-frame"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]surface.get-frame');
  const ret = rsc0.getFrame();
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.get-frame"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  var variant4 = ret;
  if (variant4 === null || variant4=== undefined) {
    dataView(memory0).setInt8(arg1 + 0, 0, true);
  } else {
    const e = variant4;
    dataView(memory0).setInt8(arg1 + 0, 1, true);
    var {nothing: v3_0 } = e;
    dataView(memory0).setInt8(arg1 + 1, v3_0 ? 1 : 0, true);
  }
  _debugLog('[iface="wasi:surface/surface@0.0.1", function="[method]surface.get-frame"][Instruction::Return]', {
    funcName: '[method]surface.get-frame',
    paramCount: 0,
    async: false,
    postReturn: false
  });
}


const trampoline53 = new WebAssembly.Suspending(async function(arg0, arg1, arg2) {
  var len3 = arg1;
  var base3 = arg0;
  var result3 = [];
  for (let i = 0; i < len3; i++) {
    const base = base3 + i * 4;
    var handle1 = dataView(memory0).getInt32(base + 0, true);
    var rep2 = handleTable0[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable0.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Pollable.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    curResourceBorrows.push(rsc0);
    result3.push(rsc0);
  }
  _debugLog('[iface="wasi:io/poll@0.2.0", function="poll"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, 'poll');
  const ret = await poll(result3);
  _debugLog('[iface="wasi:io/poll@0.2.0", function="poll"] [Instruction::CallInterface] (sync, @ post-call)');
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  endCurrentTask(0);
  var val4 = ret;
  var len4 = val4.length;
  var ptr4 = realloc0(0, 0, 4, len4 * 4);
  var src4 = new Uint8Array(val4.buffer, val4.byteOffset, len4 * 4);
  (new Uint8Array(memory0.buffer, ptr4, len4 * 4)).set(src4);
  dataView(memory0).setUint32(arg2 + 4, len4, true);
  dataView(memory0).setUint32(arg2 + 0, ptr4, true);
  _debugLog('[iface="wasi:io/poll@0.2.0", function="poll"][Instruction::Return]', {
    funcName: 'poll',
    paramCount: 0,
    async: false,
    postReturn: false
  });
}
);
let exports2;
function trampoline1(handle) {
  const handleEntry = rscTableRemove(handleTable5, handle);
  if (handleEntry.own) {
    
    const rsc = captureTable5.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose]) rsc[symbolDispose]();
      captureTable5.delete(handleEntry.rep);
    } else if (RecordOptionGpuSize64[symbolCabiDispose]) {
      RecordOptionGpuSize64[symbolCabiDispose](handleEntry.rep);
    }
  }
}
function trampoline3(handle) {
  const handleEntry = rscTableRemove(handleTable11, handle);
  if (handleEntry.own) {
    
    const rsc = captureTable11.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose]) rsc[symbolDispose]();
      captureTable11.delete(handleEntry.rep);
    } else if (RecordGpuPipelineConstantValue[symbolCabiDispose]) {
      RecordGpuPipelineConstantValue[symbolCabiDispose](handleEntry.rep);
    }
  }
}
function trampoline6(handle) {
  const handleEntry = rscTableRemove(handleTable2, handle);
  if (handleEntry.own) {
    
    const rsc = captureTable2.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose]) rsc[symbolDispose]();
      captureTable2.delete(handleEntry.rep);
    } else if (AbstractBuffer[symbolCabiDispose]) {
      AbstractBuffer[symbolCabiDispose](handleEntry.rep);
    }
  }
}
function trampoline11(handle) {
  const handleEntry = rscTableRemove(handleTable20, handle);
  if (handleEntry.own) {
    
    const rsc = captureTable20.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose]) rsc[symbolDispose]();
      captureTable20.delete(handleEntry.rep);
    } else if (Error$1[symbolCabiDispose]) {
      Error$1[symbolCabiDispose](handleEntry.rep);
    }
  }
}
function trampoline12(handle) {
  const handleEntry = rscTableRemove(handleTable21, handle);
  if (handleEntry.own) {
    
    const rsc = captureTable21.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose]) rsc[symbolDispose]();
      captureTable21.delete(handleEntry.rep);
    } else if (OutputStream[symbolCabiDispose]) {
      OutputStream[symbolCabiDispose](handleEntry.rep);
    }
  }
}
function trampoline16(handle) {
  const handleEntry = rscTableRemove(handleTable9, handle);
  if (handleEntry.own) {
    
    const rsc = captureTable9.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose]) rsc[symbolDispose]();
      captureTable9.delete(handleEntry.rep);
    } else if (GpuPipelineLayout[symbolCabiDispose]) {
      GpuPipelineLayout[symbolCabiDispose](handleEntry.rep);
    }
  }
}
function trampoline17(handle) {
  const handleEntry = rscTableRemove(handleTable14, handle);
  if (handleEntry.own) {
    
    const rsc = captureTable14.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose]) rsc[symbolDispose]();
      captureTable14.delete(handleEntry.rep);
    } else if (GpuTexture[symbolCabiDispose]) {
      GpuTexture[symbolCabiDispose](handleEntry.rep);
    }
  }
}
function trampoline18(handle) {
  const handleEntry = rscTableRemove(handleTable7, handle);
  if (handleEntry.own) {
    
    const rsc = captureTable7.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose]) rsc[symbolDispose]();
      captureTable7.delete(handleEntry.rep);
    } else if (GpuQueue[symbolCabiDispose]) {
      GpuQueue[symbolCabiDispose](handleEntry.rep);
    }
  }
}
function trampoline19(handle) {
  const handleEntry = rscTableRemove(handleTable10, handle);
  if (handleEntry.own) {
    
    const rsc = captureTable10.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose]) rsc[symbolDispose]();
      captureTable10.delete(handleEntry.rep);
    } else if (GpuShaderModule[symbolCabiDispose]) {
      GpuShaderModule[symbolCabiDispose](handleEntry.rep);
    }
  }
}
function trampoline20(handle) {
  const handleEntry = rscTableRemove(handleTable18, handle);
  if (handleEntry.own) {
    
    const rsc = captureTable18.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose]) rsc[symbolDispose]();
      captureTable18.delete(handleEntry.rep);
    } else if (GpuCommandBuffer[symbolCabiDispose]) {
      GpuCommandBuffer[symbolCabiDispose](handleEntry.rep);
    }
  }
}
function trampoline21(handle) {
  const handleEntry = rscTableRemove(handleTable13, handle);
  if (handleEntry.own) {
    
    const rsc = captureTable13.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose]) rsc[symbolDispose]();
      captureTable13.delete(handleEntry.rep);
    } else if (GpuCommandEncoder[symbolCabiDispose]) {
      GpuCommandEncoder[symbolCabiDispose](handleEntry.rep);
    }
  }
}
function trampoline22(handle) {
  const handleEntry = rscTableRemove(handleTable12, handle);
  if (handleEntry.own) {
    
    const rsc = captureTable12.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose]) rsc[symbolDispose]();
      captureTable12.delete(handleEntry.rep);
    } else if (GpuRenderPipeline[symbolCabiDispose]) {
      GpuRenderPipeline[symbolCabiDispose](handleEntry.rep);
    }
  }
}
function trampoline23(handle) {
  const handleEntry = rscTableRemove(handleTable17, handle);
  if (handleEntry.own) {
    
    const rsc = captureTable17.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose]) rsc[symbolDispose]();
      captureTable17.delete(handleEntry.rep);
    } else if (GpuRenderPassEncoder[symbolCabiDispose]) {
      GpuRenderPassEncoder[symbolCabiDispose](handleEntry.rep);
    }
  }
}
function trampoline24(handle) {
  const handleEntry = rscTableRemove(handleTable15, handle);
  if (handleEntry.own) {
    
    const rsc = captureTable15.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose]) rsc[symbolDispose]();
      captureTable15.delete(handleEntry.rep);
    } else if (GpuTextureView[symbolCabiDispose]) {
      GpuTextureView[symbolCabiDispose](handleEntry.rep);
    }
  }
}
let run020Run;

async function run() {
  _debugLog('[iface="wasi:cli/run@0.2.0", function="run"][Instruction::CallWasm] enter', {
    funcName: 'run',
    paramCount: 0,
    async: false,
    postReturn: false,
  });
  const _wasm_call_currentTaskID = startCurrentTask(0, false, 'run020Run');
  const ret = await run020Run();
  endCurrentTask(0);
  let variant0;
  switch (ret) {
    case 0: {
      variant0= {
        tag: 'ok',
        val: undefined
      };
      break;
    }
    case 1: {
      variant0= {
        tag: 'err',
        val: undefined
      };
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for expected');
    }
  }
  _debugLog('[iface="wasi:cli/run@0.2.0", function="run"][Instruction::Return]', {
    funcName: 'run',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  const retCopy = variant0;
  
  if (typeof retCopy === 'object' && retCopy.tag === 'err') {
    throw new ComponentError(retCopy.val);
  }
  return retCopy.val;
  
}

const $init = (() => {
  let gen = (function* _initGenerator () {
    const module0 = fetchCompile(new URL('./triangle.core.wasm', import.meta.url));
    const module1 = base64Compile('AGFzbQEAAAABXwpgDH9/f39/f39/f39/fwBgD39/f39/f39/f39/f39/fwBgBn9/f39/fwF/YAl/f39/f39/f38Bf2ABfwF/YAV/f39/fwF/YAN/f38AYAR/f39/AGACf38AYAN/f38AAxQTAAECAwQFBAQFBgcICAgICAgICQQFAXABExMHYRQBMAAAATEAAQEyAAIBMwADATQABAE1AAUBNgAGATcABwE4AAgBOQAJAjEwAAoCMTEACwIxMgAMAjEzAA0CMTQADgIxNQAPAjE2ABACMTcAEQIxOAASCCRpbXBvcnRzAQAKtwITHwAgACABIAIgAyAEIAUgBiAHIAggCSAKIAtBABEAAAslACAAIAEgAiADIAQgBSAGIAcgCCAJIAogCyAMIA0gDkEBEQEACxMAIAAgASACIAMgBCAFQQIRAgALGQAgACABIAIgAyAEIAUgBiAHIAhBAxEDAAsJACAAQQQRBAALEQAgACABIAIgAyAEQQURBQALCQAgAEEGEQQACwkAIABBBxEEAAsRACAAIAEgAiADIARBCBEFAAsNACAAIAEgAkEJEQYACw8AIAAgASACIANBChEHAAsLACAAIAFBCxEIAAsLACAAIAFBDBEIAAsLACAAIAFBDREIAAsLACAAIAFBDhEIAAsLACAAIAFBDxEIAAsLACAAIAFBEBEIAAsLACAAIAFBEREIAAsNACAAIAEgAkESEQkACwAvCXByb2R1Y2VycwEMcHJvY2Vzc2VkLWJ5AQ13aXQtY29tcG9uZW50BzAuMjI4LjAArQoEbmFtZQATEndpdC1jb21wb25lbnQ6c2hpbQGQChMAPWluZGlyZWN0LXdhc2k6d2ViZ3B1L3dlYmdwdUAwLjAuMS1bbWV0aG9kXWdwdS5yZXF1ZXN0LWFkYXB0ZXIBRGluZGlyZWN0LXdhc2k6d2ViZ3B1L3dlYmdwdUAwLjAuMS1bbWV0aG9kXWdwdS1hZGFwdGVyLnJlcXVlc3QtZGV2aWNlAktpbmRpcmVjdC13YXNpOndlYmdwdS93ZWJncHVAMC4wLjEtW21ldGhvZF1ncHUtZGV2aWNlLmNyZWF0ZS1waXBlbGluZS1sYXlvdXQDSWluZGlyZWN0LXdhc2k6d2ViZ3B1L3dlYmdwdUAwLjAuMS1bbWV0aG9kXWdwdS1kZXZpY2UuY3JlYXRlLXNoYWRlci1tb2R1bGUES2luZGlyZWN0LXdhc2k6d2ViZ3B1L3dlYmdwdUAwLjAuMS1bbWV0aG9kXWdwdS1kZXZpY2UuY3JlYXRlLXJlbmRlci1waXBlbGluZQVLaW5kaXJlY3Qtd2FzaTp3ZWJncHUvd2ViZ3B1QDAuMC4xLVttZXRob2RdZ3B1LWRldmljZS5jcmVhdGUtY29tbWFuZC1lbmNvZGVyBkFpbmRpcmVjdC13YXNpOndlYmdwdS93ZWJncHVAMC4wLjEtW21ldGhvZF1ncHUtdGV4dHVyZS5jcmVhdGUtdmlldwdPaW5kaXJlY3Qtd2FzaTp3ZWJncHUvd2ViZ3B1QDAuMC4xLVttZXRob2RdZ3B1LWNvbW1hbmQtZW5jb2Rlci5iZWdpbi1yZW5kZXItcGFzcwhEaW5kaXJlY3Qtd2FzaTp3ZWJncHUvd2ViZ3B1QDAuMC4xLVttZXRob2RdZ3B1LWNvbW1hbmQtZW5jb2Rlci5maW5pc2gJOmluZGlyZWN0LXdhc2k6d2ViZ3B1L3dlYmdwdUAwLjAuMS1bbWV0aG9kXWdwdS1xdWV1ZS5zdWJtaXQKTWluZGlyZWN0LXdhc2k6aW8vc3RyZWFtc0AwLjIuMC1bbWV0aG9kXW91dHB1dC1zdHJlYW0uYmxvY2tpbmctd3JpdGUtYW5kLWZsdXNoC0JpbmRpcmVjdC13YXNpOnN1cmZhY2Uvc3VyZmFjZUAwLjAuMS1bbWV0aG9kXXN1cmZhY2UuZ2V0LXBvaW50ZXItdXAMRGluZGlyZWN0LXdhc2k6c3VyZmFjZS9zdXJmYWNlQDAuMC4xLVttZXRob2Rdc3VyZmFjZS5nZXQtcG9pbnRlci1kb3duDURpbmRpcmVjdC13YXNpOnN1cmZhY2Uvc3VyZmFjZUAwLjAuMS1bbWV0aG9kXXN1cmZhY2UuZ2V0LXBvaW50ZXItbW92ZQ4+aW5kaXJlY3Qtd2FzaTpzdXJmYWNlL3N1cmZhY2VAMC4wLjEtW21ldGhvZF1zdXJmYWNlLmdldC1rZXktdXAPQGluZGlyZWN0LXdhc2k6c3VyZmFjZS9zdXJmYWNlQDAuMC4xLVttZXRob2Rdc3VyZmFjZS5nZXQta2V5LWRvd24QPmluZGlyZWN0LXdhc2k6c3VyZmFjZS9zdXJmYWNlQDAuMC4xLVttZXRob2Rdc3VyZmFjZS5nZXQtcmVzaXplET1pbmRpcmVjdC13YXNpOnN1cmZhY2Uvc3VyZmFjZUAwLjAuMS1bbWV0aG9kXXN1cmZhY2UuZ2V0LWZyYW1lEiBpbmRpcmVjdC13YXNpOmlvL3BvbGxAMC4yLjAtcG9sbA');
    const module2 = base64Compile('AGFzbQEAAAABXwpgDH9/f39/f39/f39/fwBgD39/f39/f39/f39/f39/fwBgBn9/f39/fwF/YAl/f39/f39/f38Bf2ABfwF/YAV/f39/fwF/YAN/f38AYAR/f39/AGACf38AYAN/f38AAngUAAEwAAAAATEAAQABMgACAAEzAAMAATQABAABNQAFAAE2AAQAATcABAABOAAFAAE5AAYAAjEwAAcAAjExAAgAAjEyAAgAAjEzAAgAAjE0AAgAAjE1AAgAAjE2AAgAAjE3AAgAAjE4AAkACCRpbXBvcnRzAXABExMJGQEAQQALEwABAgMEBQYHCAkKCwwNDg8QERIALwlwcm9kdWNlcnMBDHByb2Nlc3NlZC1ieQENd2l0LWNvbXBvbmVudAcwLjIyOC4wABwEbmFtZQAVFHdpdC1jb21wb25lbnQ6Zml4dXBz');
    ({ exports: exports0 } = yield instantiateCore(yield module1));
    ({ exports: exports1 } = yield instantiateCore(yield module0, {
      'wasi:cli/stdout@0.2.0': {
        'get-stdout': trampoline34,
      },
      'wasi:graphics-context/graphics-context@0.0.1': {
        '[constructor]context': trampoline13,
        '[method]context.get-current-buffer': trampoline14,
        '[method]context.present': trampoline15,
        '[resource-drop]abstract-buffer': trampoline6,
      },
      'wasi:io/error@0.2.0': {
        '[resource-drop]error': trampoline11,
      },
      'wasi:io/poll@0.2.0': {
        poll: exports0['18'],
      },
      'wasi:io/streams@0.2.0': {
        '[method]output-stream.blocking-write-and-flush': exports0['10'],
        '[resource-drop]output-stream': trampoline12,
      },
      'wasi:surface/surface@0.0.1': {
        '[constructor]surface': trampoline25,
        '[method]surface.connect-graphics-context': trampoline26,
        '[method]surface.get-frame': exports0['17'],
        '[method]surface.get-key-down': exports0['15'],
        '[method]surface.get-key-up': exports0['14'],
        '[method]surface.get-pointer-down': exports0['12'],
        '[method]surface.get-pointer-move': exports0['13'],
        '[method]surface.get-pointer-up': exports0['11'],
        '[method]surface.get-resize': exports0['16'],
        '[method]surface.subscribe-frame': trampoline33,
        '[method]surface.subscribe-key-down': trampoline31,
        '[method]surface.subscribe-key-up': trampoline30,
        '[method]surface.subscribe-pointer-down': trampoline28,
        '[method]surface.subscribe-pointer-move': trampoline29,
        '[method]surface.subscribe-pointer-up': trampoline27,
        '[method]surface.subscribe-resize': trampoline32,
      },
      'wasi:webgpu/webgpu@0.0.1': {
        '[method]gpu-adapter.request-device': exports0['1'],
        '[method]gpu-command-encoder.begin-render-pass': exports0['7'],
        '[method]gpu-command-encoder.finish': exports0['8'],
        '[method]gpu-device.connect-graphics-context': trampoline4,
        '[method]gpu-device.create-command-encoder': exports0['5'],
        '[method]gpu-device.create-pipeline-layout': exports0['2'],
        '[method]gpu-device.create-render-pipeline': exports0['4'],
        '[method]gpu-device.create-shader-module': exports0['3'],
        '[method]gpu-device.queue': trampoline2,
        '[method]gpu-queue.submit': exports0['9'],
        '[method]gpu-render-pass-encoder.draw': trampoline9,
        '[method]gpu-render-pass-encoder.end': trampoline7,
        '[method]gpu-render-pass-encoder.set-pipeline': trampoline8,
        '[method]gpu-texture.create-view': exports0['6'],
        '[method]gpu.get-preferred-canvas-format': trampoline0,
        '[method]gpu.request-adapter': exports0['0'],
        '[resource-drop]gpu-command-buffer': trampoline20,
        '[resource-drop]gpu-command-encoder': trampoline21,
        '[resource-drop]gpu-pipeline-layout': trampoline16,
        '[resource-drop]gpu-queue': trampoline18,
        '[resource-drop]gpu-render-pass-encoder': trampoline23,
        '[resource-drop]gpu-render-pipeline': trampoline22,
        '[resource-drop]gpu-shader-module': trampoline19,
        '[resource-drop]gpu-texture': trampoline17,
        '[resource-drop]gpu-texture-view': trampoline24,
        '[resource-drop]record-gpu-pipeline-constant-value': trampoline3,
        '[resource-drop]record-option-gpu-size64': trampoline1,
        '[static]gpu-texture.from-graphics-buffer': trampoline5,
        'get-gpu': trampoline10,
      },
    }));
    memory0 = exports1.memory;
    realloc0 = exports1.cabi_realloc;
    ({ exports: exports2 } = yield instantiateCore(yield module2, {
      '': {
        $imports: exports0.$imports,
        '0': trampoline35,
        '1': trampoline36,
        '10': trampoline45,
        '11': trampoline46,
        '12': trampoline47,
        '13': trampoline48,
        '14': trampoline49,
        '15': trampoline50,
        '16': trampoline51,
        '17': trampoline52,
        '18': trampoline53,
        '2': trampoline37,
        '3': trampoline38,
        '4': trampoline39,
        '5': trampoline40,
        '6': trampoline41,
        '7': trampoline42,
        '8': trampoline43,
        '9': trampoline44,
      },
    }));
    run020Run = WebAssembly.promising(exports1['wasi:cli/run@0.2.0#run']);
  })();
  let promise, resolve, reject;
  function runNext (value) {
    try {
      let done;
      do {
        ({ value, done } = gen.next(value));
      } while (!(value instanceof Promise) && !done);
      if (done) {
        if (resolve) resolve(value);
        else return value;
      }
      if (!promise) promise = new Promise((_resolve, _reject) => (resolve = _resolve, reject = _reject));
      value.then(runNext, reject);
    }
    catch (e) {
      if (reject) reject(e);
      else throw e;
    }
  }
  const maybeSyncReturn = runNext(null);
  return promise || maybeSyncReturn;
})();

await $init;
const run020 = {
  run: run,
  
};

export { run020 as run, run020 as 'wasi:cli/run@0.2.0',  }