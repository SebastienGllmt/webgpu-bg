// theoretically, this should be taken from a "poll" implementation
import { Pollable } from './gfx.js';

class ConditionVariable {
  constructor() {
    this.pollable = new Pollable();
  }
  asPollable() {
    return this.pollable;
  }
  notify() {
    this.pollable.resolve();
  }
}
export const loopback = {
  ConditionVariable,
  registerLoopback() {
    return new ConditionVariable();
  },
};