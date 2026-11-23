const test = require("node:test");
const assert = require("node:assert/strict");
const { watchTree } = require("../src/watch.cjs");
const tick = () => new Promise(resolve=>setImmediate(resolve));
const root = id => ({id, agent:"build", task:"", state:"Ожидает", children:[]});
const server = () => {
  let handle;
  return {client:{}, data:{listen(fn){handle=fn; return ()=>{handle=null};}},
    send(type,data){handle?.({name:type,details:{type,data}})}};
};
test("switching sessions cancels old work and late responses cannot replace the new tree", async () => {
  const s=server(), seen=[];
  let resolveOld, oldSignal;
  const old=watchTree(s,"old",x=>seen.push(x),(_,__,signal)=>{oldSignal=signal;return new Promise(r=>resolveOld=r)});
  old.close();
  const next=watchTree(s,"new",x=>seen.push(x),async()=>root("new"));
  resolveOld(root("old"));
  await tick();
  assert.equal(oldSignal.aborted,true);
  assert.deepEqual(seen.filter(x=>x.tree).map(x=>x.tree.id),["new"]);
  next.close();
});
test("an unavailable server is an error, retry restores data, and live activity stays scoped", async () => {
  const s=server(), log=[];
  let n=0;
  const view=watchTree(s,"r",x=>log.push(x),async()=>{if(!n++) throw new Error("offline");return root("r")});
  try {
    await tick();assert.ok(log.at(-1).error);
    await view.refresh();assert.equal(log.at(-1).tree.id,"r");
    s.send("session.text.started",{sessionID:"else"});assert.equal(log.at(-1).tree.state,"Ожидает");
    s.send("session.text.started",{sessionID:"r"});assert.equal(log.at(-1).tree.state,"Пишет ответ");
    s.send("session.execution.succeeded",{sessionID:"r"});assert.equal(log.at(-1).tree.state,"Завершил работу");
    view.close();
    const count=log.length;
    s.send("session.execution.started",{sessionID:"r"});assert.equal(log.length,count);
  } finally {view.close()}
});

test("a disconnect immediately invalidates even an empty snapshot until reconnection succeeds", async () => {
  const s=server(), log=[]; s.connected=true;
  const view=watchTree(s,"r",x=>log.push(x),async()=>root("r"));
  try {
    await tick();assert.equal(log.at(-1).tree.children.length,0);
    view.connection(false);
    assert.ok(log.at(-1).error);
    assert.equal(log.at(-1).empty,false);
    view.connection(true);
    await tick();assert.equal(log.at(-1).empty,true);
    assert.ok(!log.at(-1).error);
  } finally {view.close()}
});

test("finishing one tool does not mask the other active call", async () => {
  const s=server(), log=[];
  const view=watchTree(s,"r",x=>log.push(x),async()=>root("r"));
  try {
    await tick();
    s.send("session.tool.input.started",{sessionID:"r",id:"t1",name:"grep"});
    s.send("session.tool.input.started",{sessionID:"r",id:"t2",name:"shell"});
    s.send("session.tool.success",{sessionID:"r",id:"t1"});
    assert.equal(log.at(-1).tree.state,"Выполняет команду");
    s.send("session.tool.failed",{sessionID:"r",id:"t2"});
    assert.equal(log.at(-1).tree.state,"Работает");
  } finally {view.close()}
});
