"use strict";
const {loadTree, toolState} = require("./tree.cjs");

const states = new Map(Object.entries({
  "session.execution.started":"Работает", "session.step.started":"Работает",
  "session.reasoning.started":"Обдумывает", "session.text.started":"Пишет ответ",
  "session.execution.succeeded":"Завершил работу", "session.execution.failed":"Ошибка",
  "session.execution.interrupted":"Остановлен", "session.retry.scheduled":"Повторяет запрос",
  "permission.asked":"Ждёт разрешения", "form.created":"Ждёт ответа",
  "session.tool.success":"Работает", "session.tool.failed":"Работает",
  "permission.replied":"Работает", "form.replied":"Работает",
}));
const structural = new Set(["session.created","session.deleted","session.renamed","session.agent.selected",
  "session.archived","session.unarchived","experimental.job.updated"]);

function watchTree(server,id,notify,load=loadTree) {
  const controller=new AbortController();
  let tree, error, members=new Map(), replay, timer, pending=false, disposed=false;
  const emit=()=>notify({tree,error});
  function schedule() {
    if(!timer && !disposed) timer=setTimeout(()=>{timer=null;void refresh()},300);
  }
  function apply(key,state,update) {
    const row=members.get(key);
    if(!row || row.state===state) return;
    row.state=state;
    if(update) notify({tree,error,changed:row});
  }
  async function refresh() {
    if(disposed) return;
    if(replay){pending=true;return}
    replay=new Map();
    try {
      const next=await load(server.client,id,controller.signal);
      if(disposed) return;
      tree=next; members=new Map();
      const todo=[tree];
      while(todo.length){const row=todo.pop();members.set(row.id,row);todo.push(...row.children)}
      for(const [key,state] of replay) apply(key,state,false);
      error=null;emit();
    } catch(e) {
      if(!disposed){error=e;emit()}
    } finally {
      replay=null;
      if(pending){pending=false;schedule()}
    }
  }
  const off=server.data.listen(({name,details})=>{
    if(name==="server.connected"){schedule();return}
    if(!states.has(name) && !structural.has(name) && name!=="session.tool.input.started") return;
    const d=details.data, key=d.sessionID ?? d.form?.sessionID ?? d.info?.sessionID;
    if(structural.has(name)){
      if(name==="experimental.job.updated" && d.info?.kind!=="subagent") return;
      if(key===id || members.has(key) || members.has(d.parentID) || (!tree && replay)) schedule();
      return;
    }
    if(!key || (!replay && !members.has(key))) return;
    const state=name==="session.tool.input.started" ? toolState(d.name) : states.get(name);
    if(replay) replay.set(key,state);
    apply(key,state,true);
  });
  // Recover missed events and failed snapshots even after a quiet reconnect.
  const interval=setInterval(schedule,60000);
  emit();void refresh();
  return {refresh,close(){
    if(disposed) return;
    disposed=true; controller.abort();off();clearTimeout(timer);clearInterval(interval);
  }};
}
module.exports={watchTree};
