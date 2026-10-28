// Draft formula scenarios only; no provider calls or production integration.
import fs from 'node:fs';
fs.mkdirSync('.data', {recursive:true});
const weights=[.55,.20,.10,.15],speedRefs=[10000,500,100,50],totalRefs=[100000,5000,1000,500],rateRefs=[.05,.01,.005];
const clip=(x,lo=0,hi=1)=>Math.max(lo,Math.min(hi,x));
const norm=(x,ref)=>clip(Math.log1p(Math.max(0,x))/Math.log1p(ref));
const sum=(xs,ws)=>xs.reduce((s,x,i)=>s+x*ws[i],0);
function score({total,delta,hours=1,ageHours=3,previous=null,previousHours=1}){
 if(total.some(x=>x===null)||delta.some(x=>x===null))return {status:'insufficient',heat:null};
 if(delta[0]<0||total.some(x=>x<0))return {status:'anomaly',heat:null};
 const positive=delta.map(x=>Math.max(0,x));
 const A=sum(positive.map((x,i)=>norm(x/hours,speedRefs[i])),weights);
 if(positive[0]===0&&positive.slice(1).some(x=>x>0))return {status:'partial',heat:null,reason:'plays lag interactions'};
 const Q=positive[0]===0?0:sum(positive.slice(1).map((x,i)=>norm(x/(positive[0]+200),rateRefs[i])),[.45,.20,.35]);
 const B=sum(total.map((x,i)=>norm(x,totalRefs[i])),weights);
 const F=Math.pow(2,-ageHours/72);
 let G=0,hasMomentum=false;
 if(previous&&hours<=6&&previousHours<=6&&hours/previousHours>=.5&&hours/previousHours<=2&&previous[0]>=0){
  const z=sum(positive,[1,5,10,15])/hours,pz=sum(previous.map(x=>Math.max(0,x)),[1,5,10,15])/previousHours;
  G=clip(Math.log2((z+200)/(pz+200))/2,-1,1)*Math.min(1,positive[0]/200,previous[0]/200);hasMomentum=true;
 }
 return {status:hours>6?'coarse':positive[0]<200?'low-sample':'ok',heat:Math.round(100*clip(A*(.60+.25*Q+.05*G)+.10*B*F)*10)/10,A,Q,B,G,hasMomentum};
}
const cases=[
 ['新视频持续起量',{total:[10000,600,100,80],delta:[4000,240,40,32],previous:[2000,120,20,16],ageHours:3}],
 ['同速度老视频再起量',{total:[100000,6000,1000,800],delta:[4000,240,40,32],previous:[2000,120,20,16],ageHours:180*24}],
 ['老视频爆发',{total:[2000000,100000,10000,5000],delta:[20000,1000,200,100],previous:[200,10,2,1],ageHours:180*24}],
 ['老视频大累计但停止增长',{total:[2000000,100000,10000,5000],delta:[0,0,0,0],previous:[20000,1000,200,100],ageHours:180*24}],
 ['10播放5点赞的小样本',{total:[10,5,0,0],delta:[10,5,0,0],ageHours:1}],
 ['同一视频较上一小时降速',{total:[10000,600,100,80],delta:[200,12,2,1],previous:[4000,240,40,32],ageHours:3}],
 ['等速查询一小时',{total:[10000,600,100,80],delta:[1000,50,10,5],hours:1,ageHours:3}],
 ['等速查询两小时',{total:[10000,600,100,80],delta:[2000,100,20,10],hours:2,ageHours:3}],
 ['播放缺失',{total:[null,600,100,80],delta:[null,50,10,5],ageHours:3}],
 ['播放回撤',{total:[10000,600,100,80],delta:[-100,50,10,5],ageHours:3}],
 ['一天一次粗粒度',{total:[100000,6000,1000,800],delta:[24000,1200,240,120],hours:24,ageHours:180*24}]
];
const result=cases.map(([name,input])=>({name,...score(input)}));
if(!(result[2].heat>result[0].heat&&result[0].heat>result[4].heat&&result[1].heat>result[5].heat&&result[3].heat<1&&result[0].heat-result[1].heat<10&&result[8].heat===null&&result[9].heat===null))throw new Error('scenario assertion failed');
if(Math.abs(result[6].A-result[7].A)>1e-12)throw new Error('equal velocity must have equal activity score');
if(result.some(x=>x.heat!==null&&(x.heat<0||x.heat>100)))throw new Error('score out of range');
fs.writeFileSync('.data/heat-score-simulation.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result.map(({name,heat,status})=>({name,heat,status})),null,2));
