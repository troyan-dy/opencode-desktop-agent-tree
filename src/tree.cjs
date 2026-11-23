"use strict";

const outcomes = {succeeded:"Завершил работу", failed:"Ошибка", interrupted:"Остановлен"};
const activities = {read:"Читает файл", glob:"Ищет файлы", grep:"Ищет по файлам",
  shell:"Выполняет команду", patch:"Редактирует файлы", subagent:"Запускает агента",
  websearch:"Ищет в интернете", webfetch:"Читает страницу", question:"Ждёт ответа"};

function toolState(name) {
  return Object.hasOwn(activities, name) ? activities[name] : name ? `Выполняет: ${name}` : "Выполняет инструмент";
}

function executionState(info, running, message) {
  if (!running) return outcomes[info.outcome] || "Ожидает";
  if (!message || message.time.completed != null || message.time.created < (info.time?.busy ?? 0)) return "Работает";
  const content = message.content || [];
  const tool = content.findLast(part => part.type === "tool" && ["streaming","running"].includes(part.state.status));
  if (tool) return toolState(tool.name);
  return content.at(-1)?.type === "text" ? "Пишет ответ" : "Работает";
}

async function loadTree(client, sessionID, signal) {
  const options = {signal};
  let root = await client.session.get({sessionID}, options);
  const ancestors = new Set([root.id]);
  while (root.parentID && !root.fork && !ancestors.has(root.parentID)) {
    signal.throwIfAborted();
    ancestors.add(root.parentID);
    root = await client.session.get({sessionID:root.parentID}, options);
  }
  const [active, jobs] = await Promise.all([client.session.active(options),
    client.experimental.job.list({sessionID:root.id, descendants:true, kind:"subagent"}, options)]);
  const latest = new Map();
  for (const job of jobs) {
    if (job.kind === "subagent" && (!latest.has(job.childSessionID) ||
        latest.get(job.childSessionID).time.started < job.time.started)) latest.set(job.childSessionID,job);
  }
  const visited = new Set([root.id]);
  const queue = [{info:root, children:[]}];
  const roots = queue[0].children;
  for (let index=0; index<queue.length;) {
    signal.throwIfAborted();
    const batch = queue.slice(index,index+6);
    index += batch.length;
    await Promise.all(batch.map(async ({info,children}) => {
      const running = active[info.id]?.type === "running";
      const job = latest.get(info.id);
      const [message, descendants] = await Promise.all([
        running ? client.message.list({sessionID:info.id,type:"assistant",limit:1,order:"desc"},options)
          .then(page=>page.data[0]) : undefined,
        listChildren(client, info.id, options),
      ]);
      const row = {id:info.id, agent:info.agent || job?.agent || (info.id===root.id?"Основной агент":"Агент"),
        task:job?.description || info.title || "", state:executionState(info,running,message), children:[]};
      children.push(row);
      for (const child of descendants) {
        if (child.fork || child.parentID !== info.id || visited.has(child.id)) continue;
        visited.add(child.id);
        queue.push({info:child, children:row.children});
      }
    }));
  }
  // Concurrent requests must not reorder siblings between refreshes.
  const order = new Map(queue.map(({info})=>[info.id,info.time?.created ?? 0]));
  for (const children of new Set(queue.map(item=>item.children)))
    children.sort((a,b)=>order.get(a.id)-order.get(b.id) || a.id.localeCompare(b.id));
  return roots[0];
}

async function listChildren(client, parentID, options) {
  const children = [];
  let cursor;
  do {
    options.signal.throwIfAborted();
    const page = await client.session.list(cursor ? {cursor,limit:100} : {parentID,limit:100}, options);
    children.push(...page.data);
    cursor = page.cursor.next;
  } while (cursor);
  return children;
}

module.exports = {loadTree, executionState, toolState};
