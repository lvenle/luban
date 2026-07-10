import { runDueScheduledTasks } from '../models/scheduled-task.js';

let timer = null;
let running = false;

export function startScheduledTaskRunner(intervalMs = Number(process.env.LUBAN_SCHEDULE_INTERVAL_MS || 30_000)) {
  if (timer || intervalMs <= 0) return;
  const tick = () => {
    if (running) return;
    running = true;
    try {
      runDueScheduledTasks();
    } catch (error) {
      console.error('[scheduled-task-runner] 定时任务执行失败：', error.stack || error.message);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
}

export function stopScheduledTaskRunner() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
