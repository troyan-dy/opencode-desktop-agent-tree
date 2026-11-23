"use strict";
const {createEffect,createMemo,untrack}=require("solid-js");
const {el}=require("./card-view.cjs");

const number=new Intl.NumberFormat("ru-RU");
function contextRing(server,id,lastAssistantWithUsage){
  const data=server.data,info=()=>data.session.get(id);
  const measured=createMemo(()=>lastAssistantWithUsage(data.session.message.list(id),info()?.revert?.messageID));
  const directory=createMemo(()=>info()?.location?.directory);
  // Historical children can live in a location whose model catalog was never opened.
  createEffect(()=>{
    const dir=directory();
    if(dir && server.connected!==false)untrack(()=>{void data.location.model.sync?.({directory:dir}).catch(()=>{})});
  });
  const meter=el("span","ap-context"),value=el("span");
  meter.setAttribute("role","img");
  const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg");
  svg.setAttribute("viewBox","0 0 14 14");svg.setAttribute("width","14");svg.setAttribute("height","14");
  svg.setAttribute("fill","none");svg.setAttribute("aria-hidden","true");
  svg.dataset.component="progress-circle";svg.dataset.appearance="compact";
  function circle(slot){
    const c=document.createElementNS(ns,"circle");c.dataset.slot=slot;
    c.setAttribute("cx","7");c.setAttribute("cy","7");c.setAttribute("r","6.25");c.setAttribute("stroke-width","1.5");
    svg.append(c);return c;
  }
  circle("progress-circle-background");
  const arc=circle("progress-circle-progress");arc.setAttribute("pathLength","100");arc.setAttribute("stroke-dasharray","100");
  meter.append(svg,value);
  createEffect(()=>{
    const step=measured(),t=step?.tokens,ref=step?.model,loc=info()?.location;
    const used=t?t.input+t.output+t.reasoning+t.cache.read+t.cache.write:null;
    const limit=ref&&loc?data.location.model.list(loc)?.findLast(m=>m.providerID===ref.providerID&&m.id===ref.id&&m.status!=="deprecated")?.limit?.context:null;
    const percent=used!==null && Number.isFinite(limit) && limit>0?100*used/limit:null;
    const count=used===null?"—":number.format(used);
    value.textContent=used===null?"Контекст: —":`${count} ток.${percent===null?"":` · ${Math.round(percent)}%`}`;
    svg.toggleAttribute("hidden",percent===null);
    if(percent!==null)arc.setAttribute("stroke-dashoffset",String(100-Math.min(100,Math.max(0,percent))));
    const label=used===null?"Контекст: пока нет измерения":percent===null?`Контекст: ${count} токенов. Лимит модели неизвестен.`:
      `Контекст: ${count} из ${number.format(limit)} токенов (${Math.round(percent)}%)`;
    meter.title=label;meter.setAttribute("aria-label",label);
  });
  return meter;
}
module.exports={contextRing};
