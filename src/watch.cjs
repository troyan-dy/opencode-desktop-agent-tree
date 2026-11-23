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
  const history=new Map();
  let tree, error, members=new Map(), tools=new Map(), replay, request, timer, pending=false, disposed=false;
  let online=server.connected!==false;
  const emit=()=>notify({tree,error,empty:!!tree && !tree.children.length && !error && online});
  function schedule() {
    if(!timer && !disposed) timer=setTimeout(()=>{timer=null;void refresh()},300);
  }
  function apply(key,name,d,update) {
    const row=members.get(key);
    if(!row)return;
    const calls=tools.get(key);
    let state=states.get(name);
    if(name==="session.tool.input.started"){
      calls.set(d.id,d.name);state=toolState(d.name);
    } else if(name==="session.tool.success" || name==="session.tool.failed"){
      const isAssignment=calls.get(d.id)==="subagent" || !!d.metadata?.sessionID;
      calls.delete(d.id);
      if(calls.size)state=toolState([...calls.values()].at(-1));
      if(update && isAssignment && name==="session.tool.success")schedule();
    } else if(name.startsWith("session.execution."))calls.clear();
    if(row.state===state)return;
    row.state=state;
    if(update) notify({tree,error,changed:row});
  }
  async function refresh() {
    if(disposed || !online) return;
    if(replay){pending=true;return}
    replay=[];
    const ctrl=new AbortController();request=ctrl;
    try {
      const next=await load(server.client,id,ctrl.signal,history);
      if(ctrl.signal.aborted) return;
      tree=next; members=new Map();tools=new Map();
      const todo=[tree];
      while(todo.length){const row=todo.pop();members.set(row.id,row);tools.set(row.id,new Map(row.tools));todo.push(...row.children)}
      for(const [key,name,d] of replay) apply(key,name,d,false);
      error=null;emit();
    } catch(e) {
      if(!ctrl.signal.aborted){error=e;emit()}
    } finally {
      replay=null;request=null;
      if(pending){pending=false;schedule()}
    }
  }
  const off=server.data.listen(({name,details})=>{
    if(!online)return;
    if(name==="server.connected"){schedule();return}
    if(!states.has(name) && !structural.has(name) && name!=="session.tool.input.started") return;
    const d=details.data, key=d.sessionID ?? d.form?.sessionID ?? d.info?.sessionID;
    if(structural.has(name)){
      if(name==="experimental.job.updated" && d.info?.kind!=="subagent") return;
      if(key===id || members.has(key) || members.has(d.parentID) || (!tree && replay)) schedule();
      return;
    }
    if(!key || (!replay && !members.has(key))) return;
    const event={id:d.id,name:d.name,metadata:{sessionID:d.metadata?.sessionID}};
    if(replay)replay.push([key,name,event]);
    apply(key,name,event,true);
  });
  // Recover missed events and failed snapshots even after a quiet reconnect.
  const interval=setInterval(schedule,60000);
  if(!online)error=new Error("offline");
  emit();void refresh();
  return {refresh,connection(connected){
    if(disposed || online===connected)return;
    online=connected;
    if(!online){request?.abort();error=new Error("offline");emit()}
    else void refresh();
  },close(){
    if(disposed) return;
    disposed=true; request?.abort();off();clearTimeout(timer);clearInterval(interval);
  }};
}
module.exports={watchTree};
