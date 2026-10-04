const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const DB_FILE = path.join(DATA_DIR, "store.json");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Checklist content is transcribed from the supplied "QC confirmed with Contractor - Shorter Version" document.
const ACTIVITIES = [
  ["01","Material Unloading",["Punch mark / identification photographed","Punch-off and transfer completed","Material thickness checked","Heat No. maintained"],"OK / NOT OK"],
  ["02","Cutting",["Right angle checked","Layout checked as per drawing","Material identification maintained","Number stencilling confirmed"],"OK / NOT OK"],
  ["03","Scrap Segregation / Disposal",["Scrap generated after cutting has been segregated and disposed of as instructed."],"CONFIRMED / NOT CONFIRMED"],
  ["04","Dish-End / Outside Process",["Job No. mentioned on outgoing challan","Quantity/details checked","Material identification maintained","Job No. verified on returning challan","Dish-end cutting/grinding checked","Welding completed as instructed","Component identification maintained"],"OK / NOT OK"],
  ["05","Weld Cap / Outside Process",["Job No. mentioned on outgoing challan","Job No. verified on return","Quantity verified","Identification maintained"],"OK / NOT OK"],
  ["06","Rolling",["Front pressing / 8–7 line checked","Gauge rolling confirmed","LZ setup gap confirmed","Diameter checked","Rolling condition acceptable"],"OK / HOLD"],
  ["07","Fit-up — Mandatory QC Witness",["Thickness checked","Setup gap checked","Layout matches drawing","Punch transfer confirmed","Joint preparation checked","Alignment / Hi-Low checked","Tack weld checked","Weld joint identification marked"],"RELEASED / REWORK / HOLD"],
  ["08","Welding",["Correct WPS available","Qualified welder confirmed","Preheat arranged","Holding oven available","Correct welding consumable available","Coupon plate / runner plate provided where required","Welding rod batch No. recorded","TC / consumable traceability confirmed","Preheat maintained","Interpass controlled","Welding parameters followed","Welding identification maintained"],"OK / HOLD"],
  ["09","Back-chipping & Dye Penetrant — Mandatory QC Hold",["Back-chipping completed","Root cleaned/grinded","Full joint visually checked","Dye penetrant completed","100% joint covered","QC informed/witnessed"],"ACCEPTED / REPAIR / HOLD"],
  ["10","Nozzle Opening",["V-edge formation completed","Nozzle location checked","Nozzle orientation checked","Photograph taken","Photograph uploaded/shared with QC","QC reviewed photograph"],"REVIEWED"],
  ["11","Reinforcement Pads",["Correct location","Correct size","Pin hole provided","Weld completed 100%","Weld visually checked","QC informed"],"OK / HOLD"],
  ["12","Radiography / Repair",["All required RT offered","RT completed as required","RT result received","Any repair location identified","Repair completed","Re-shoot completed","Final result accepted"],"ACCEPTED / REPAIR / HOLD"],
  ["13","Cutting Edge / Grinding / Hard Punch",["Cutting edge properly finished","Grinding completed","No sharp/unacceptable edges","Hard punch fully welded","Weld visually checked"],"OK"],
  ["14","Internal / External Visual — QC Witness",["External surface checked","Dents checked","Weld surface checked","Grinding completed","Internal surface cleaned","Internal visual inspection completed after second dish-end","QC informed","QC witness completed","No foreign material/debris left inside"],"OK / HOLD"],
  ["15","PWHT — Where Applicable",["PWHT arrangement completed","Correct job/tank identification","Calibration confirmed","Temperature monitored","Required holding time completed","PWHT photograph taken","PWHT chart obtained","Calibration certificate available"],"ACCEPTED"],
  ["16","Mounting",["Foot plate welding completed","Surface cleaned before welding","Nuts/bolts tightened before welding","Gusset welding completed","Burr removed","Weld spatter removed","Flux completely removed","Rubbing plate bolts tightened","Straightness checked"],"OK / REWORK"],
  ["17","Hydrotest — QC/TPIA",["All required welding completed","Required NDT completed","PWHT completed where applicable","Visual inspection completed","Tank ready for hydrotest","Pressure gauge calibration valid","Correct test pressure achieved","Required duration maintained","No leakage","No visible defect","Photograph taken","QC/TPIA clearance obtained"],"PASS / FAIL"],
  ["18","Sandblasting",["Weld cap area properly blasted","Top area properly blasted","Root gauge area properly blasted","Difficult areas below running gear blasted","No unblasted areas","Mill scale/scrap not visible","Surface preparation accepted"],"ACCEPTED / REWORK"],
  ["19","Painting / Colour",["Surface preparation completed","QC informed before primer","Surface defects checked","Defects rectified","QC approval obtained","Correct colour confirmed","Paint batch confirmed","Mixing completed in presence of QC","Paint applied as specified"],"ACCEPTED / REWORK"],
  ["20","Accessories",["Catwalk pads fully welded","Other accessory pads fully welded","Welds checked","Catwalk/items properly fabricated","Primer completed","Colour completed","QC confirmation obtained before mounting"],"APPROVED FOR MOUNTING"]
].map(([no,name,points,outcome]) => ({
  no,name,points,outcome,
  control: /Mandatory QC Witness|Mandatory QC Hold|Hydrotest|QC Witness/.test(name)
}));

const AUTH_USER = process.env.RELAX_OWNER_USERNAME || "RELAX FAB";
const AUTH_PASS = process.env.RELAX_OWNER_PASSWORD || "NIKHIL SIR 1";
const EMPLOYERS = [
  {username:"EMPLOYER 1", password:"RELAX@101", name:"Employer 1"},
  {username:"EMPLOYER 2", password:"RELAX@202", name:"Employer 2"},
  {username:"EMPLOYER 3", password:"RELAX@303", name:"Employer 3"},
  {username:"EMPLOYER 4", password:"RELAX@404", name:"Employer 4"}
];
const POSITIVE_STATUSES = new Set(["RELEASED","PASS","ACCEPTED","APPROVED FOR MOUNTING","OK","REVIEWED","CONFIRMED"]);
function isPositiveStageStatus(stage,status){
  const normalized=String(status||"").trim().toUpperCase();
  if(!stage || !normalized) return false;
  // The first outcome is the successful/accepted outcome for every checklist stage.
  // This makes the lock engine follow the checklist definition itself instead of
  // relying on a separate hard-coded list that can miss a stage-specific value
  // such as Stage 03's CONFIRMED result.
  const success=String(stage.outcome||"").split(" / ")[0].trim().toUpperCase();
  return normalized===success;
}
const NEGATIVE_STATUSES = new Set(["HOLD","REWORK","FAIL","REPAIR","NOT OK","NOT CONFIRMED"]);
const sessions = new Map();

function loadStore(){try{if(!fs.existsSync(DB_FILE))return{jobs:[],nextId:1};const d=JSON.parse(fs.readFileSync(DB_FILE,"utf8"));if(!d||!Array.isArray(d.jobs))return{jobs:[],nextId:1};d.jobs.forEach(j=>{j.attachments=Array.isArray(j.attachments)?j.attachments:[];j.checks=j.checks||{};});return d;}catch{return{jobs:[],nextId:1};}}
function saveStore(store){const tmp=DB_FILE+".tmp";fs.writeFileSync(tmp,JSON.stringify(store,null,2),"utf8");fs.renameSync(tmp,DB_FILE);}
function now(){return new Date().toISOString();}
function safeName(name){return String(name||"file").replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,120);}
function publicJob(job){const copy=JSON.parse(JSON.stringify(job));copy.createdBy=job.createdBy||"";copy.createdByName=job.createdByName||"";copy.attachments=(copy.attachments||[]).map(a=>({...a,url:`/uploads/${encodeURIComponent(a.savedName)}`}));copy.stageLock=getStageLock(job);return copy;}
function stageComplete(job, stageNo){
  const stage=ACTIVITIES.find(a=>a.no===stageNo);
  const c=job.checks?.[stageNo];
  if(!stage || !c) return false;
  const points=Array.isArray(c.pointChecks)?c.pointChecks:[];
  // A stage is complete only when every checklist point is checked, the
  // contractor has confirmed it, QC has given a positive result, and both
  // names/signatures have been entered. Trim/case-normalize saved values so
  // a browser refresh or minor whitespace cannot leave the next stage locked.
  const allPoints=stage.points.every((_,i)=>points[i]===true);
  const contractorStatus=String(c.contractorStatus||"").trim().toUpperCase();
  const qcStatus=String(c.status||"").trim().toUpperCase();
  const contractorConfirmed=["DONE","CHECKED","CONFIRMED"].includes(contractorStatus);
  const qcPassed=isPositiveStageStatus(stage,qcStatus);
  // Signature/name fields may be intentionally inherited from the job-level
  // supervisor/QC engineer fields. Treat those as valid signatures too.
  const contractorSignature=String(c.contractorSignature||job.supervisor||"").trim();
  const qcSignature=String(c.qcSignature||job.qcEngineer||"").trim();
  return allPoints && contractorConfirmed && qcPassed && !!contractorSignature && !!qcSignature;
}
function getStageLock(job){
  // IMPORTANT: completion is strictly sequential. We stop at the first
  // incomplete stage, so Stage 4 can unlock only after Stage 3 is genuinely
  // complete, and the same rule applies through Stage 20.
  const completed=[];
  for(const stage of ACTIVITIES){
    if(!stageComplete(job,stage.no)) break;
    completed.push(stage.no);
  }
  const nextStage=completed.length<ACTIVITIES.length?ACTIVITIES[completed.length].no:null;
  return {nextStage,completed,allComplete:completed.length===ACTIVITIES.length};
}
function token(){return crypto.randomBytes(32).toString("hex");}
function requireAuth(req,res,next){const t=req.headers.authorization?.replace(/^Bearer\s+/i,"");if(!t||!sessions.has(t))return res.status(401).json({error:"Login required"});req.session=sessions.get(t);next();}
function requireOwner(req,res,next){if(req.session?.role!=="Owner")return res.status(403).json({error:"Owner access required"});next();}
function requireEmployer(req,res,next){if(req.session?.role!=="Employer")return res.status(403).json({error:"Employer access required"});next();}
function canAccessJob(job,session){return session?.role==="Owner" || job.createdBy===session.username || (!job.createdBy && session?.role==="Employer" && job.contractor===session.name);}
function ownerDashboard(store){
  const employers=EMPLOYERS.map(e=>({username:e.username,name:e.name,jobs:0,completed:0,inProgress:0,blocked:0}));
  const jobs=store.jobs.map(j=>{
    const lock=getStageLock(j);
    const done=lock.completed.length;
    const completed=Object.values(j.checks||{}).filter(c=>POSITIVE_STATUSES.has(c.status)).length;
    const blocked=Object.values(j.checks||{}).filter(c=>NEGATIVE_STATUSES.has(c.status)).length;
    const employer=employers.find(e=>e.username===j.createdBy);
    if(employer){employer.jobs++;employer.completed+=(lock.allComplete?1:0);employer.inProgress+=(lock.allComplete?0:1);employer.blocked+=(blocked>0?1:0);}
    return {id:j.id,jobNo:j.jobNo,contractor:j.contractor,date:j.date,employerUsername:j.createdBy||"LEGACY / UNKNOWN",employerName:employer?.name||j.createdBy||"Legacy / Unknown",completedStages:done,totalStages:ACTIVITIES.length,positiveStages:completed,blockedStages:blocked,allComplete:lock.allComplete,contractorConfirmed:!!j.contractorConfirmed,qcConfirmed:!!j.qcConfirmed,updatedAt:j.updatedAt};
  }).sort((a,b)=>b.id-a.id);
  return {employers,jobs,totals:{jobs:jobs.length,fullyComplete:jobs.filter(j=>j.allComplete).length,inProgress:jobs.filter(j=>!j.allComplete).length,blocked:jobs.filter(j=>j.blockedStages>0).length}};
}

const storage=multer.diskStorage({destination:(_req,_file,cb)=>cb(null,UPLOAD_DIR),filename:(_req,file,cb)=>cb(null,Date.now()+"-"+crypto.randomBytes(6).toString("hex")+"-"+safeName(file.originalname))});
const upload=multer({
  storage,
  limits:{fileSize:15*1024*1024,files:10},
  fileFilter:(_req,file,cb)=>{
    const type=String(file.mimetype||"").toLowerCase();
    const allowed=type.startsWith("image/") || type==="application/pdf" || type==="text/plain";
    if(!allowed) return cb(new Error(`Unsupported evidence file type: ${type||"unknown"}. Please upload an image, PDF or TXT file.`));
    cb(null,true);
  }
});
app.use(express.json({limit:"2mb"}));app.use(express.urlencoded({extended:true}));app.use("/uploads",express.static(UPLOAD_DIR));app.use(express.static(path.join(ROOT,"public")));

app.get("/api/health",(_req,res)=>res.json({ok:true,service:"Relax QC Control Center",node:process.version}));
app.post("/api/login",(req,res)=>{
  const username=String(req.body?.username||"").trim();
  const password=String(req.body?.password||"");
  let user=null;
  if(username===AUTH_USER && password===AUTH_PASS) user={username,role:"Owner",name:"Company Owner"};
  else { const e=EMPLOYERS.find(x=>x.username===username && x.password===password); if(e) user={username:e.username,role:"Employer",name:e.name}; }
  if(!user)return res.status(401).json({error:"Invalid username or password"});
  const t=token();sessions.set(t,{...user,createdAt:Date.now()});res.json({ok:true,token:t,user});
});
app.post("/api/logout",requireAuth,(req,res)=>{const t=req.headers.authorization?.replace(/^Bearer\s+/i,"");sessions.delete(t);res.json({ok:true});});
app.get("/api/me",requireAuth,(req,res)=>res.json({ok:true,user:{username:req.session.username,role:req.session.role,name:req.session.name}}));
app.get("/api/activities",requireAuth,(_req,res)=>res.json(ACTIVITIES));

app.get("/api/owner/dashboard",requireAuth,requireOwner,(req,res)=>res.json(ownerDashboard(loadStore())));
app.get("/api/jobs",requireAuth,(req,res)=>{const store=loadStore();const visible=store.jobs.filter(j=>canAccessJob(j,req.session));const list=visible.map(j=>{const completed=Object.values(j.checks||{}).filter(c=>POSITIVE_STATUSES.has(c.status)).length;const blocked=Object.values(j.checks||{}).filter(c=>NEGATIVE_STATUSES.has(c.status)).length;const lock=getStageLock(j);return{id:j.id,jobNo:j.jobNo,contractor:j.contractor,date:j.date,createdBy:j.createdBy||"",createdByName:j.createdByName||"",completed:lock.completed.length,blocked,updatedAt:j.updatedAt,allComplete:lock.allComplete};}).sort((a,b)=>b.id-a.id);res.json(list);});
app.get("/api/jobs/:id",requireAuth,(req,res)=>{const job=loadStore().jobs.find(j=>j.id===Number(req.params.id));if(!job)return res.status(404).json({error:"Job not found"});if(!canAccessJob(job,req.session))return res.status(403).json({error:"You do not have access to this job"});res.json(publicJob(job));});
app.post("/api/jobs",requireAuth,requireEmployer,(req,res)=>{const store=loadStore(),b=req.body||{};if(!String(b.jobNo||"").trim())return res.status(400).json({error:"Job / Tank No. is required."});const job={id:store.nextId++,createdBy:req.session.username,createdByName:req.session.name,contractor:String(b.contractor||""),jobNo:String(b.jobNo||"").trim(),activity:String(b.activity||""),date:String(b.date||""),supervisor:String(b.supervisor||""),qcEngineer:String(b.qcEngineer||""),notes:String(b.notes||""),checks:{},contractorConfirmed:false,qcConfirmed:false,attachments:[],createdAt:now(),updatedAt:now()};store.jobs.push(job);saveStore(store);res.status(201).json(publicJob(job));});
app.put("/api/jobs/:id",requireAuth,requireEmployer,(req,res)=>{const store=loadStore(),job=store.jobs.find(j=>j.id===Number(req.params.id));if(!job)return res.status(404).json({error:"Job not found"});if(!canAccessJob(job,req.session))return res.status(403).json({error:"You do not have access to this job"});const b=req.body||{};for(const k of ["contractor","jobNo","activity","date","supervisor","qcEngineer","notes"]){if(b[k]!==undefined)job[k]=String(b[k]||"");}if(b.contractorConfirmed!==undefined)job.contractorConfirmed=!!b.contractorConfirmed;if(b.qcConfirmed!==undefined)job.qcConfirmed=!!b.qcConfirmed;job.updatedAt=now();saveStore(store);res.json(publicJob(job));});
app.delete("/api/jobs/:id",requireAuth,requireEmployer,(req,res)=>{const store=loadStore(),idx=store.jobs.findIndex(j=>j.id===Number(req.params.id));if(idx<0)return res.status(404).json({error:"Job not found"});if(!canAccessJob(store.jobs[idx],req.session))return res.status(403).json({error:"You do not have access to this job"});for(const a of(store.jobs[idx].attachments||[])){try{fs.unlinkSync(path.join(UPLOAD_DIR,a.savedName));}catch{}}store.jobs.splice(idx,1);saveStore(store);res.json({ok:true});});
app.put("/api/jobs/:id/checks/:stageNo",requireAuth,requireEmployer,(req,res)=>{
  const store=loadStore(),job=store.jobs.find(j=>j.id===Number(req.params.id));
  if(!job)return res.status(404).json({error:"Job not found"});
  if(!canAccessJob(job,req.session))return res.status(403).json({error:"You do not have access to this job"});
  const no=String(req.params.stageNo).padStart(2,"0"),stage=ACTIVITIES.find(a=>a.no===no);
  if(!stage)return res.status(400).json({error:"Invalid stage"});
  const stageIndex=ACTIVITIES.findIndex(a=>a.no===no);
  if(stageIndex>0 && !stageComplete(job,ACTIVITIES[stageIndex-1].no)) return res.status(423).json({error:`Stage ${no} is locked. Complete Stage ${ACTIVITIES[stageIndex-1].no} fully before proceeding.`});
  const status=String(req.body?.status||"PENDING");
  const allowed=["PENDING","IN PROGRESS","RELEASED","REWORK","HOLD","PASS","FAIL","ACCEPTED","REPAIR","NOT OK","OK","REVIEWED","APPROVED FOR MOUNTING","CONFIRMED","NOT CONFIRMED"];
  if(!allowed.includes(status))return res.status(400).json({error:"Invalid status"});
  job.checks[no]={status,notes:String(req.body?.notes||""),contractorStatus:String(req.body?.contractorStatus||""),pointChecks:Array.isArray(req.body?.pointChecks)?req.body.pointChecks:[],contractorSignature:String(req.body?.contractorSignature||""),qcSignature:String(req.body?.qcSignature||""),updatedAt:now(),updatedBy:req.session.username};
  job.updatedAt=now();saveStore(store);res.json(publicJob(job));
});
app.post("/api/jobs/:id/attachments",requireAuth,requireEmployer,(req,res,next)=>{
  upload.array("files",10)(req,res,err=>{
    if(err){
      const message=err.code==="LIMIT_FILE_SIZE"?"Evidence file is too large. Maximum size is 15 MB per file.":err.code==="LIMIT_FILE_COUNT"?"You can upload a maximum of 10 evidence files at once.":err.message||"Evidence upload failed.";
      return res.status(400).json({error:message});
    }
    next();
  });
},(req,res)=>{
  const store=loadStore(),job=store.jobs.find(j=>j.id===Number(req.params.id));
  if(!job)return res.status(404).json({error:"Job not found"});
  if(!canAccessJob(job,req.session))return res.status(403).json({error:"You do not have access to this job"});
  const stageNo=String(req.body?.stageNo||"").padStart(2,"0");
  if(!ACTIVITIES.some(a=>a.no===stageNo))return res.status(400).json({error:"Invalid stage"});
  const files=Array.isArray(req.files)?req.files:[];
  if(!files.length)return res.status(400).json({error:"No evidence file was received. Select a photo/PDF/TXT file and try again."});
  for(const f of files)job.attachments.push({id:crypto.randomUUID(),stageNo,originalName:f.originalname,savedName:f.filename,size:f.size,mime:f.mimetype,createdAt:now(),uploadedBy:req.session.username,uploadedByName:req.session.name});
  job.updatedAt=now();saveStore(store);res.status(201).json(publicJob(job));
});
app.delete("/api/jobs/:id/attachments/:attachmentId",requireAuth,requireEmployer,(req,res)=>{const store=loadStore(),job=store.jobs.find(j=>j.id===Number(req.params.id));if(!job)return res.status(404).json({error:"Job not found"});if(!canAccessJob(job,req.session))return res.status(403).json({error:"You do not have access to this job"});const idx=job.attachments.findIndex(a=>a.id===req.params.attachmentId);if(idx<0)return res.status(404).json({error:"Attachment not found"});const a=job.attachments[idx];try{fs.unlinkSync(path.join(UPLOAD_DIR,a.savedName));}catch{}job.attachments.splice(idx,1);job.updatedAt=now();saveStore(store);res.json(publicJob(job));});
app.get("/api/jobs/:id/export",requireAuth,(req,res)=>{const job=loadStore().jobs.find(j=>j.id===Number(req.params.id));if(!job)return res.status(404).json({error:"Job not found"});if(!canAccessJob(job,req.session))return res.status(403).json({error:"You do not have access to this job"});res.setHeader("Content-Disposition",`attachment; filename="${safeName(job.jobNo||"qc-job")}.json"`);res.json(publicJob(job));});
app.use((err,_req,res,_next)=>{console.error(err);if(res.headersSent)return;res.status(err.statusCode||400).json({error:err.message||"Request failed"});});
app.get("*",(_req,res)=>res.sendFile(path.join(ROOT,"public","index.html")));
app.listen(PORT,()=>console.log(`\nRELAX QC CONTROL CENTER\nRunning at http://localhost:${PORT}\nNode ${process.version}\nData file: ${DB_FILE}\n`));
