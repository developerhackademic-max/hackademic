process.env.DB_PATH=':memory:';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');
const recordingDir=fs.mkdtempSync(path.join(os.tmpdir(),'hackademic-recordings-'));
process.env.RECORDING_DIR=recordingDir;
const server=require('../server');
const {demoSeed,one}=require('../db');
demoSeed();

test('Manager tools, protected video recordings, and Admin SEO settings',async()=>{
  await new Promise(resolve=>server.listen(0,resolve));
  try{
    const base=`http://127.0.0.1:${server.address().port}`;
    const json=async(url,options={})=>{const response=await fetch(base+url,options);return{response,data:await response.json()}};
    let result=await json('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'hr@hackademic.demo',password:'HackademicDemo!2026'})});
    assert.equal(result.response.status,200);
    const manager=result.data,managerCookie=result.response.headers.get('set-cookie').split(';')[0];
    const managerHeaders={cookie:managerCookie,'Content-Type':'application/json','X-CSRF-Token':manager.csrf};

    result=await json('/api/dashboard',{headers:{cookie:managerCookie}});
    assert.equal(result.response.status,200);
    assert.ok(!('applications' in result.data.stats));
    assert.ok(!('openJobs' in result.data.stats));

    result=await json('/api/manage/users',{headers:{cookie:managerCookie}});
    assert.equal(result.response.status,200);
    assert.ok(result.data.items.some(user=>user.role==='student'));
    assert.ok(result.data.items.every(user=>user.role==='student'));
    result=await json('/api/manage/student',{method:'POST',headers:managerHeaders,body:JSON.stringify({name:'Manager Test Student',email:'manager-student@example.test',password:'ManagerTestPassword!2026'})});
    assert.equal(result.response.status,201);
    const studentId=result.data.id,courseId=Number(one("SELECT id FROM courses WHERE slug='ethical-hacking-cyber-security'").id);
    result=await json('/api/manage/enroll',{method:'POST',headers:managerHeaders,body:JSON.stringify({user_id:studentId,course_id:courseId})});
    assert.equal(result.response.status,201);

    result=await json('/api/manage/batch',{method:'POST',headers:managerHeaders,body:JSON.stringify({course_id:courseId,name:'Manager Weekend Batch',starts_on:'2027-01-16',mode:'Hybrid',schedule:'Saturday morning',seats:20})});
    assert.equal(result.response.status,201);
    result=await json('/api/manage/batches',{headers:{cookie:managerCookie}});
    assert.ok(result.data.items.some(batch=>batch.name==='Manager Weekend Batch'));
    result=await json('/api/manage/service',{method:'POST',headers:managerHeaders,body:JSON.stringify({title:'Manager Added Service',slug:'manager-added-service',description:'A manager-created website service.',published:1})});
    assert.equal(result.response.status,201);
    result=await json('/api/services');
    assert.ok(result.data.items.some(service=>service.slug==='manager-added-service'));

    const video=Buffer.from([0,0,0,24,...Buffer.from('ftypisom'),0,0,0,0]);
    result=await json('/api/manage/recording-upload',{method:'POST',headers:{cookie:managerCookie,'X-CSRF-Token':manager.csrf,'X-Recording-Extension':'mp4','Content-Type':'video/mp4'},body:video});
    assert.equal(result.response.status,201);
    const recording=result.data;
    result=await json('/api/manage/lesson',{method:'POST',headers:managerHeaders,body:JSON.stringify({course_id:courseId,title:'Uploaded Manager Recording',content:'Recording uploaded through the Manager workspace.',video_url:recording.url,sort_order:9})});
    assert.equal(result.response.status,201);
    let recordingResponse=await fetch(base+recording.url,{headers:{Range:'bytes=0-3'}});
    assert.equal(recordingResponse.status,401);
    result=await json('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'manager-student@example.test',password:'ManagerTestPassword!2026'})});
    assert.equal(result.response.status,200);
    const studentCookie=result.response.headers.get('set-cookie').split(';')[0];
    recordingResponse=await fetch(base+recording.url,{headers:{cookie:studentCookie,Range:'bytes=0-3'}});
    assert.equal(recordingResponse.status,206);
    assert.deepEqual(Buffer.from(await recordingResponse.arrayBuffer()),video.subarray(0,4));

    result=await json('/api/manage/leave_requests',{headers:{cookie:managerCookie}});
    assert.equal(result.response.status,200);
    const pendingLeave=result.data.items.find(item=>item.status==='pending');
    assert.ok(pendingLeave);
    result=await json('/api/manage/update',{method:'POST',headers:managerHeaders,body:JSON.stringify({table:'leave_requests',id:pendingLeave.id,status:'approved'})});
    assert.equal(result.response.status,200);

    result=await json('/api/manage/seo',{headers:{cookie:managerCookie}});
    assert.equal(result.response.status,403);
    result=await json('/api/manage/blog_posts',{headers:{cookie:managerCookie}});
    assert.equal(result.response.status,403);
    result=await json('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@hackademic.demo',password:'HackademicDemo!2026'})});
    assert.equal(result.response.status,200);
    const admin=result.data,adminCookie=result.response.headers.get('set-cookie').split(';')[0],adminHeaders={cookie:adminCookie,'Content-Type':'application/json','X-CSRF-Token':admin.csrf};
    result=await json('/api/manage/seo',{headers:{cookie:adminCookie}});
    assert.equal(result.response.status,200);
    assert.ok(result.data.pages.some(page=>page.page==='about.html'));

    result=await json('/api/manage/seo/page',{method:'POST',headers:adminHeaders,body:JSON.stringify({page:'about.html',title:'SEO panel integration test',description:'Verified metadata from the Admin SEO panel.',canonical:'https://www.hackademic.in/about.html',robots:'noindex,follow',og_title:'About Hackademic',og_description:'Social preview test.',og_image:'/assets/hackademic-mark.png',include_sitemap:0,changefreq:'monthly',priority:0.6})});
    assert.equal(result.response.status,200);
    const aboutPage=await (await fetch(base+'/about.html')).text();
    assert.ok(aboutPage.includes('<title>SEO panel integration test</title>'));
    assert.ok(aboutPage.includes('<meta name="robots" content="noindex,follow">'));
    assert.ok(aboutPage.includes('<meta property="og:title" content="About Hackademic">'));
    const sitemap=await (await fetch(base+'/sitemap.xml')).text();
    assert.ok(!sitemap.includes('<loc>https://www.hackademic.in/about.html</loc>'));

    const robotsTxt='User-agent: *\nDisallow: /internal/\n\nSitemap: https://www.hackademic.in/sitemap.xml';
    result=await json('/api/manage/seo/robots',{method:'POST',headers:adminHeaders,body:JSON.stringify({content:robotsTxt})});
    assert.equal(result.response.status,200);
    assert.equal(await (await fetch(base+'/robots.txt')).text(),robotsTxt);
  }finally{
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(recordingDir,{recursive:true,force:true});
  }
});
