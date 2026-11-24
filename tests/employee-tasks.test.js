process.env.DB_PATH=':memory:';
const test=require('node:test');
const assert=require('node:assert/strict');
const {db,init,addUser,now,one,all,run}=require('../db');

db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,password_salt TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','hr','instructor','student')),phone TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,csrf TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL);`);
const adminId=addUser('Existing Admin','admin@example.test','AdminPassword!2026','admin');
const managerId=addUser('Existing Manager','manager@example.test','ManagerPassword!2026','hr');
run('INSERT INTO sessions(token_hash,user_id,csrf,expires_at,created_at) VALUES(?,?,?,?,?)','existing-session',adminId,'csrf-token',new Date(Date.now()+86400000).toISOString(),now());
init();
assert.equal(one('SELECT role FROM users WHERE id=?',adminId).role,'admin');
assert.equal(one('SELECT user_id FROM sessions WHERE token_hash=?','existing-session').user_id,adminId);
assert.deepEqual(all('PRAGMA foreign_key_check'),[]);
const legacyEmployeeId=Number(run('INSERT INTO employees(name,email,department,designation,joined_at) VALUES(?,?,?,?,?)','Legacy Staff','legacy.staff@example.test','Operations','Coordinator','2025-01-01').lastInsertRowid);

const server=require('../server');

test('employee accounts and task assignment, progress, and reminders',async()=>{
  await new Promise(resolve=>server.listen(0,resolve));
  try{
    const base=`http://127.0.0.1:${server.address().port}`;
    const json=async(url,options={})=>{const response=await fetch(base+url,options);return{response,data:await response.json()}};
    const login=async(email,password)=>{
      const result=await json('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
      assert.equal(result.response.status,200);
      return{user:result.data.user,headers:{cookie:result.response.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json','X-CSRF-Token':result.data.csrf}};
    };
    const manager=await login('manager@example.test','ManagerPassword!2026');
    const admin=await login('admin@example.test','AdminPassword!2026');
    let result=await json('/api/manage/employee-account',{method:'POST',headers:manager.headers,body:JSON.stringify({employee_id:legacyEmployeeId,password:'LegacyEmployeePassword!2026'})});
    assert.equal(result.response.status,201);
    const legacyEmployee=await login('legacy.staff@example.test','LegacyEmployeePassword!2026');
    result=await json('/api/my/tasks',{headers:legacyEmployee.headers});
    assert.equal(result.response.status,200);
    assert.deepEqual(result.data.items,[]);
    result=await json('/api/manage/employee',{method:'POST',headers:manager.headers,body:JSON.stringify({name:'Task Employee',email:'task.employee@example.test',department:'Operations',designation:'Coordinator',joined_at:'2026-11-24',password:'EmployeePassword!2026'})});
    assert.equal(result.response.status,201);
    const employeeId=result.data.id;
    const employee=await login('task.employee@example.test','EmployeePassword!2026');
    assert.equal(employee.user.role,'employee');

    const overdueDate=new Date(Date.now()-86400000).toISOString().slice(0,10);
    result=await json('/api/manage/task',{method:'POST',headers:manager.headers,body:JSON.stringify({employee_id:employeeId,title:'Manager task',due_date:overdueDate,priority:'low'})});
    assert.equal(result.response.status,403);
    result=await json('/api/manage/task',{method:'POST',headers:admin.headers,body:JSON.stringify({employee_id:employeeId,title:'Prepare weekly report',description:'Summarize this week’s work.',due_date:overdueDate,priority:'high'})});
    assert.equal(result.response.status,201);
    const taskId=result.data.id;

    result=await json('/api/manage/tasks',{headers:manager.headers});
    assert.equal(result.response.status,403);
    result=await json('/api/manage/tasks',{headers:admin.headers});
    assert.equal(result.response.status,200);
    assert.equal(result.data.items[0].priority,'high');
    assert.equal(result.data.items[0].progress,0);
    assert.equal(result.data.items[0].employee,'Task Employee');

    result=await json('/api/my/tasks',{headers:employee.headers});
    assert.equal(result.response.status,200);
    assert.equal(result.data.items.length,1);
    assert.equal(result.data.items[0].due_date,overdueDate);

    result=await json('/api/my/task',{method:'POST',headers:employee.headers,body:JSON.stringify({id:taskId,status:'pending',progress:40})});
    assert.equal(result.response.status,200);
    assert.equal(result.data.status,'in_progress');
    assert.equal(result.data.progress,40);
    result=await json('/api/my/task',{method:'POST',headers:employee.headers,body:JSON.stringify({id:taskId,status:'completed',progress:70})});
    assert.equal(result.response.status,200);
    assert.equal(result.data.progress,100);

    result=await json('/api/manage/update',{method:'POST',headers:manager.headers,body:JSON.stringify({table:'tasks',id:taskId,status:'pending'})});
    assert.equal(result.response.status,403);
    result=await json('/api/manage/update',{method:'POST',headers:admin.headers,body:JSON.stringify({table:'tasks',id:taskId,status:'pending'})});
    assert.equal(result.response.status,200);
    result=await json('/api/manage/tasks',{headers:admin.headers});
    assert.equal(result.data.items[0].progress,0);
    assert.equal(result.data.items[0].status,'pending');

    result=await json('/api/manage/task',{method:'POST',headers:admin.headers,body:JSON.stringify({employee_id:employeeId,title:'Bad deadline',due_date:'2026-02-31',priority:'medium'})});
    assert.equal(result.response.status,400);
    result=await json('/api/my/task',{method:'POST',headers:employee.headers,body:JSON.stringify({id:taskId,status:'in_progress',progress:101})});
    assert.equal(result.response.status,400);
    result=await json('/api/manage/task',{method:'POST',headers:employee.headers,body:JSON.stringify({employee_id:employeeId,title:'Unauthorized task',due_date:overdueDate,priority:'low'})});
    assert.equal(result.response.status,403);

    result=await json('/api/manage/employee',{method:'POST',headers:admin.headers,body:JSON.stringify({name:'Other Employee',email:'other.employee@example.test',department:'Operations',designation:'Coordinator',joined_at:'2026-11-24',password:'OtherEmployeePassword!2026'})});
    assert.equal(result.response.status,201);
    const otherEmployeeId=result.data.id;
    const otherLogin=await login('other.employee@example.test','OtherEmployeePassword!2026');
    result=await json('/api/my/tasks',{headers:otherLogin.headers});
    assert.equal(result.response.status,200);
    assert.deepEqual(result.data.items,[]);
    result=await json('/api/my/task',{method:'POST',headers:otherLogin.headers,body:JSON.stringify({id:taskId,status:'completed',progress:100})});
    assert.equal(result.response.status,404);
    result=await json('/api/manage/task',{method:'POST',headers:admin.headers,body:JSON.stringify({employee_id:otherEmployeeId,title:'Admin assigned task',due_date:overdueDate,priority:'low'})});
    assert.equal(result.response.status,201);
    result=await json('/api/my/tasks',{headers:otherLogin.headers});
    assert.equal(result.data.items.length,1);
    assert.equal(result.data.items[0].title,'Admin assigned task');
  }finally{
    await new Promise(resolve=>server.close(resolve));
  }
});
