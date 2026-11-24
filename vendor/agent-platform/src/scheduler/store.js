import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class JsonScheduleStore {
  #queue = Promise.resolve();

  constructor(path) {
    if (typeof path !== 'string' || !path) throw new TypeError('schedule store path is required');
    this.path = path;
  }

  list() {
    return this.#locked(async () => structuredClone((await this.#read()).schedules));
  }

  get(id) {
    return this.#locked(async () => {
      const schedule = (await this.#read()).schedules.find(item => item.id === id);
      return schedule ? structuredClone(schedule) : null;
    });
  }

  upsert(schedule) {
    return this.#locked(async () => {
      const state = await this.#read();
      const index = state.schedules.findIndex(item => item.id === schedule.id);
      if (index >= 0) state.schedules[index] = structuredClone(schedule);
      else state.schedules.push(structuredClone(schedule));
      await this.#write(state);
      return structuredClone(schedule);
    });
  }

  remove(id) {
    return this.#locked(async () => {
      const state = await this.#read();
      const before = state.schedules.length;
      state.schedules = state.schedules.filter(item => item.id !== id);
      if (state.schedules.length !== before) await this.#write(state);
      return state.schedules.length !== before;
    });
  }

  /**
   * 原子读-改-写：在同一把锁内完成读取与写回，避免并发写入互相覆盖
   *（如跳过原因记录与执行中状态更新同时发生）。
   */
  mutate(id, patch) {
    return this.#locked(async () => {
      const state = await this.#read();
      const index = state.schedules.findIndex(item => item.id === id);
      if (index < 0) return null;
      const current = structuredClone(state.schedules[index]);
      const updated = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
      state.schedules[index] = structuredClone(updated ?? current);
      await this.#write(state);
      return structuredClone(state.schedules[index]);
    });
  }

  #locked(action) {
    const next = this.#queue.then(action, action);
    this.#queue = next.catch(() => {});
    return next;
  }

  async #read() {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8'));
      if (parsed.version !== 1 || !Array.isArray(parsed.schedules)) throw new Error('Invalid schedule store');
      return parsed;
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, schedules: [] };
      throw error;
    }
  }

  async #write(state) {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, this.path);
  }
}
