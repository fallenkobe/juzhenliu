import { chromium, type BrowserContext, type Page, type Locator } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assistantDirectory } from '../../packages/assistant/paths';
import { metricColumns, parseMetric, parseRows, parseWorkbook, compareDatasets, type AssistantSnapshot, type Dataset, type VisibleMetric } from '../../packages/assistant/metrics';
import {parseFansWorkbook,rangeLabels,validatePeriod,summarizeWorks,summarizeFans,type AnalysisRecord,type AnalysisRange,type AnalysisTopic} from '../../packages/assistant/analysis';

const urls={home:'https://creator.douyin.com/creator-micro/home',data:'https://creator.douyin.com/creator-micro/data-center/operation'};
export type AssistantPage=keyof typeof urls;
function allowedPage(page:Page){try{return new URL(page.url()).origin==='https://creator.douyin.com';}catch{return false;}}
export class BrowserAssistant{
  private directory:string;
  constructor(private options:{directory?:string;contextFactory?:()=>Promise<BrowserContext>}={}){this.directory=options.directory||assistantDirectory;}
  private context:BrowserContext|null=null;
  private page:Page|null=null;
  private snapshot:AssistantSnapshot|null=null;
  private reference:Dataset|null=null;
  private analyses:AnalysisRecord[]=[];
  private busy=false;
  private downloadMessage='';
  private lastCapture:string|null=null;
  async initialize(){
    await mkdir(this.directory,{recursive:true});
    for(const [filename,assign] of [['latest.json',(v:any)=>{this.snapshot=v;}],['reference.json',(v:any)=>{this.reference=v;}]] as const)try{assign(JSON.parse(await readFile(path.join(this.directory,filename),'utf8')));}catch{}
    try{const rows=JSON.parse(await readFile(path.join(this.directory,'analyses.json'),'utf8'));if(Array.isArray(rows))this.analyses=rows;}catch{}
    if(!this.analyses.length&&this.snapshot?.dataset?.rows.length===30)this.analyses.push({id:this.snapshot.id,accountLabel:this.snapshot.accountLabel,capturedAt:this.snapshot.capturedAt,topic:'works',range:'30d',dataset:this.snapshot.dataset});
  }
  private async exclusive<T>(fn:()=>Promise<T>){if(this.busy)throw new Error('助手正在执行另一个操作，请稍候');this.busy=true;try{return await fn();}finally{this.busy=false;}}
  async open(target:AssistantPage='home'){
    return this.exclusive(async()=>{
      if(!this.context){
        this.context=this.options.contextFactory?await this.options.contextFactory():await chromium.launchPersistentContext(path.join(this.directory,'profile'),{channel:'msedge',headless:false,acceptDownloads:true,viewport:null,timeout:30000});
        this.context.on('close',()=>{this.context=null;this.page=null;});
      }
      this.page=this.context.pages().find(allowedPage)||this.context.pages()[0]||await this.context.newPage();
      this.page.on('download',download=>{
        if(!allowedPage(this.page!))return;
        this.downloadMessage='浏览器已发起下载；可使用「自动导出并同步」捕获官方指标表。';
      });
      await this.page.goto(urls[target],{waitUntil:'domcontentloaded',timeout:30000});await this.page.bringToFront();
      return{ok:true,message:target==='data'?'已打开数据表现页，请确认账号、日期及短视频指标':'已打开独立 Edge 窗口；如显示登录页面，请自行扫码。'};
    });
  }
  private async currentPage(){
    const page=this.context?.pages().find(p=>!p.isClosed()&&allowedPage(p));if(!page)throw new Error('请先打开助手浏览器，并在创作者中心登录');this.page=page;return page;
  }
  private async workExport(page:Page):Promise<Locator>{
    return this.dataExport(page,'works');
  }
  private async dataExport(page:Page,topic:AnalysisTopic):Promise<Locator>{
    const heading=topic==='works'?'作品数据':'粉丝数据',marker=topic==='works'?'5秒完播率':'总粉丝量',other=topic==='works'?'粉丝数据':'作品数据';
    await page.getByText(marker,{exact:true}).first().waitFor({state:'visible',timeout:10000}).catch(()=>{});
    const candidates=page.getByRole('button',{name:/导出数据|数据导出|下载数据/}).filter({visible:true});
    const count=await candidates.count();
    const matches:number[]=[];
    for(let i=0;i<count;i++){
      const matchesWorks=await candidates.nth(i).evaluate((node,labels)=>{let p:Element|null=node;for(let depth=0;depth<7&&p;depth++,p=p.parentElement){const text=(p as HTMLElement).innerText||'';if(text.includes(labels.heading)&&text.includes(labels.marker)&&!text.includes(labels.other))return true;}return false;},{heading,marker,other});
      if(matchesWorks)matches.push(i);
    }
    if(matches.length!==1)throw new Error(`没有找到唯一的${heading}导出按钮，请在助手浏览器打开数据表现页`);return candidates.nth(matches[0]);
  }
  private dataSection(button:Locator,topic:AnalysisTopic){
    const heading=topic==='works'?'作品数据':'粉丝数据',marker=topic==='works'?'5秒完播率':'总粉丝量';
    return button.locator(`xpath=ancestor::*[contains(.,"${heading}") and .//*[normalize-space(.)="${marker}"]][1]`);
  }
  private async selectPeriod(page:Page,topic:AnalysisTopic,range:AnalysisRange){
    const section=this.dataSection(await this.dataExport(page,topic),topic),control=section.getByText(rangeLabels[range],{exact:true}).filter({visible:true});
    if(await control.count()!==1)throw new Error(`无法唯一定位${rangeLabels[range]}选项`);await control.click({timeout:5000});
  }
  private async downloadData(page:Page,topic:AnalysisTopic){
    const button=await this.dataExport(page,topic);
    const pending=page.waitForEvent('download',{timeout:20000}).then(download=>({download})).catch(()=>({download:null}));
    try{await button.click({timeout:5000});}catch{throw new Error('导出按钮无法点击，请检查浏览器页面');}
    const {download}=await pending;if(!download)throw new Error('未收到官方导出文件，已有分析保留；请检查浏览器后重试');
    if(!/\.xlsx$/i.test(download.suggestedFilename()))throw new Error('本次下载不是 XLSX，未更新分析');
    const directory=path.join(this.directory,'exports');await mkdir(directory,{recursive:true});const filename=path.join(directory,randomUUID()+'.xlsx');
    await download.saveAs(filename);return readFile(filename);
  }
  async analyze(accountLabel:string,topic:AnalysisTopic,range:AnalysisRange){
    return this.exclusive(async()=>{
      const page=await this.currentPage();
      if(!new URL(page.url()).pathname.startsWith('/creator-micro/data-center/'))await page.goto(urls.data,{waitUntil:'domcontentloaded',timeout:30000});
      await this.selectPeriod(page,topic,range);
      const buffer=await this.downloadData(page,topic),base={id:randomUUID(),accountLabel,range,capturedAt:new Date().toISOString()};
      const record:AnalysisRecord=topic==='works'?{...base,topic,dataset:await parseWorkbook(buffer,'native_export')}:{...base,topic,dataset:await parseFansWorkbook(buffer)};
      validatePeriod(record.dataset,range);
      const next=[...this.analyses.filter(r=>!(r.accountLabel===accountLabel&&r.topic===topic&&r.range===range)),record].slice(-120);
      await writeFile(path.join(this.directory,'analyses.json'),JSON.stringify(next),{mode:0o600});this.analyses=next;
      return{ok:true,message:`${topic==='works'?'作品':'粉丝'}${rangeLabels[range]}分析已更新（${record.dataset.start} 至 ${record.dataset.end}）`};
    });
  }
  async last30Days(){
    return this.exclusive(async()=>{
      const page=await this.currentPage(),button=await this.workExport(page);
      const section=button.locator('xpath=ancestor::*[contains(.,"作品数据") and .//*[normalize-space(.)="5秒完播率"]][1]');
      const control=section.getByText('近30天',{exact:true}).filter({visible:true});
      if(await control.count()!==1)throw new Error('无法唯一确定作品数据的「近30天」选项，请在浏览器选择日期');
      await control.click({timeout:5000});return{ok:true,message:'已选择作品数据近 30 天；以官方导出文件中的日期为准'};
    });
  }
  async status(){
    let state='closed',pagePath:string|null=null,message='助手浏览器尚未打开';
    const page=this.context?.pages().find(p=>!p.isClosed()&&allowedPage(p));
    if(page){
      pagePath=new URL(page.url()).pathname;
      const text=await page.locator('body').innerText({timeout:3000}).catch(()=>'');
      if(/扫码登录|手机号登录|验证码登录|使用抖音.*扫码|登录抖音创作者中心/.test(text)){state='login_required';message='请在独立 Edge 窗口中扫码登录；验证码或安全验证由你完成';}
      else if(/数据中心|作品管理|内容管理|创作者中心/.test(text)&&!/扫码登录/.test(text)){state='creator_visible';message='创作者页面可见，请确认当前账号后读取数据';}
      else{state='unknown';message='等待页面加载或人工确认登录状态';}
    }
    return{version:'0.11',online:true,busy:this.busy,browser:{state,pagePath,message},snapshot:this.snapshot,reference:this.reference,comparison:compareDatasets(this.reference,this.snapshot?.dataset??null),analyses:this.analyses.map(r=>({...r,summary:r.topic==='works'?summarizeWorks(r.dataset):summarizeFans(r.dataset)})),downloadMessage:this.downloadMessage,lastCapture:this.lastCapture};
  }
  async inspect(accountLabel:string){
    return this.exclusive(async()=>{
      const page=await this.currentPage(),text=await page.locator('body').innerText({timeout:10000});
      if(/扫码登录|手机号登录|验证码登录|使用抖音.*扫码/.test(text))throw new Error('请先在助手浏览器完成抖音登录');
      const tables=await page.locator('table,[role="table"],[role="grid"]').evaluateAll(nodes=>nodes.slice(0,10).map(table=>Array.from(table.querySelectorAll('tr,[role="row"]')).slice(0,501).map(row=>Array.from(row.querySelectorAll('th,td,[role="cell"],[role="columnheader"],[role="gridcell"]')).slice(0,30).map(cell=>(cell as HTMLElement).innerText))));
      let dataset:Dataset|null=null;for(const rows of tables)try{dataset=parseRows(rows,'visible_table');break;}catch{}
      const contexts=await page.evaluate(labels=>{
        const result:{label:string;lines:string[]}[]=[];
        for(const label of labels){
          const nodes=Array.from(document.querySelectorAll('span,div,p,th')).filter(n=>((n as HTMLElement).innerText||'').replace(/[\s\u200b\ufeff]/g,'')===label&&(n as HTMLElement).getBoundingClientRect().width>0);
          for(const node of nodes){let parent:Element|null=node.parentElement;for(let depth=0;depth<4&&parent;depth++,parent=parent.parentElement){let lines=((parent as HTMLElement).innerText||'').split('\n').map(s=>s.trim()).filter(Boolean);if(lines.length>12)break;if(!lines.includes(label)&&parent.children.length<=8)lines=Array.from(parent.children).map(c=>(c as HTMLElement).innerText?.trim()).filter(Boolean);const named=lines.filter(s=>labels.includes(s.replace(/[\s\u200b\ufeff]/g,'')));if(new Set(named.map(s=>s.replace(/[\s\u200b\ufeff]/g,''))).size>1)break;if(lines.length>=2){result.push({label,lines});}}}
        }return result;
      },metricColumns.map(c=>c.label) as string[]);
      const metrics:VisibleMetric[]=[];
      for(const col of metricColumns){const candidates:{raw:string;value:number}[]=[];
        for(const context of contexts.filter(c=>c.label===col.label)){const index=context.lines.findIndex(s=>s.replace(/\s/g,'')===col.label);const raw=context.lines[index+1];if(raw!==undefined)try{const value=parseMetric(raw,col.kind);if(value!==null)candidates.push({raw,value});}catch{}}
        const unique=[...new Map(candidates.map(c=>[c.value,c])).values()];if(unique.length===1)metrics.push({label:col.label,kind:col.kind,...unique[0]});
      }
      const controls=await page.getByRole('button').allTextContents();
      const exportButtons=controls.map(s=>s.trim()).filter(s=>/导出|下载/.test(s)).slice(0,10);
      const exportControls=await page.getByRole('button',{name:/导出数据/}).evaluateAll(nodes=>nodes.slice(0,6).map(node=>{let parent:Element|null=node;const context:string[]=[];for(let i=0;i<5&&parent;i++,parent=parent.parentElement)context.push((parent as HTMLElement).innerText?.slice(0,600)||'');return{label:(node as HTMLElement).innerText,context};}));
      await page.screenshot({path:path.join(this.directory,'page-preview.png'),fullPage:false});
      const message=dataset?`已读取 ${dataset.rows.length} 天的可见表格数据`:metrics.length?`已读取 ${metrics.length} 项页面可见指标；趋势图不推测为每日明细`:'当前页面没有识别到匹配的指标表；请打开「数据中心」后再试';
      await this.save({id:randomUUID(),capturedAt:new Date().toISOString(),accountLabel,source:'visible_page',pagePath:new URL(page.url()).pathname,metrics,dataset,message});
      return{ok:true,message,exportButtons,exportControls};
    });
  }
  async exportAndSync(accountLabel:string){
    return this.exclusive(async()=>{
      const page=await this.currentPage();
      if(!new URL(page.url()).pathname.startsWith('/creator-micro/data-center/'))throw new Error('请先在助手浏览器进入「数据中心 → 数据表现」，选择与参考表一致的日期和指标');
      const body=await page.locator('body').innerText({timeout:10000});if(/扫码登录|手机号登录|验证码登录/.test(body))throw new Error('请先完成抖音登录');
      // Click only an observed, uniquely matched export control; never publication controls.
      const button=await this.workExport(page);
      const pending=page.waitForEvent('download',{timeout:20000}).then(d=>({download:d,error:false as const})).catch(()=>({download:null,error:true as const}));
      try{await button.click({timeout:5000});}catch{throw new Error('导出控件未能点击，请检查浏览器页面');}
      const outcome=await pending;
      if(outcome.error||!outcome.download)throw new Error('尚未收到下载，可能需要在浏览器里确认导出选项；完成后重新尝试。没有生成同步成功记录。');
      const download=outcome.download;
      if(!/\.xlsx$/i.test(download.suggestedFilename()))throw new Error('本次下载不是 XLSX，尚未同步');
      const directory=path.join(this.directory,'exports');await mkdir(directory,{recursive:true});const filename=path.join(directory,randomUUID()+'.xlsx');
      await download.saveAs(filename);const dataset=await parseWorkbook(await readFile(filename),'native_export');
      const message=`已通过官方导出按钮同步 ${dataset.rows.length} 天的每日指标`;
      await this.save({id:randomUUID(),capturedAt:new Date().toISOString(),accountLabel,source:'native_export',pagePath:new URL(page.url()).pathname,metrics:[],dataset,message});
      this.downloadMessage='已捕获官方 Excel 并解析，原始文件保存在本机。';return{ok:true,message};
    });
  }
  async setReference(buffer:Buffer){const reference=await parseWorkbook(buffer,'reference');this.reference=reference;await writeFile(path.join(this.directory,'reference.json'),JSON.stringify(reference),{mode:0o600});return{ok:true,message:`参考表已载入 ${reference.rows.length} 天数据`};}
  private async save(snapshot:AssistantSnapshot){await writeFile(path.join(this.directory,'latest.json'),JSON.stringify(snapshot),{mode:0o600});this.snapshot=snapshot;this.lastCapture=snapshot.capturedAt;}
  async close(){await this.context?.close();return{ok:true};}
}
