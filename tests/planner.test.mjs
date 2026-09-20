import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blank,dateKey,deadlineText,localInput,taskGroup,urgency,validateState} from '../lib/planner.ts';
const now = new Date('2026-09-19T12:00:00Z').getTime();
const task = {id:'a',title:'Read',subject:'English',due:'2026-09-19T13:00:00Z',minutes:20,importance:'Normal',done:null};
test('urgency follows deadline boundaries and completion',()=>{
  assert.equal(urgency(task,now).label,'Due soon');
  assert.equal(urgency({...task,due:'2026-09-19T11:00:00Z'},now).label,'Overdue');
  assert.equal(urgency({...task,due:'2026-09-21T12:00:00Z'},now).label,'Coming up');
  assert.equal(urgency({...task,due:'2026-09-24T12:00:00Z'},now).label,'On the horizon');
  assert.equal(urgency({...task,done:'2026-09-19T11:00:00Z'},now).label,'Completed');
});
test('local date inputs round-trip without UTC date shifting',()=>{
  const d=new Date(2026,8,19,23,45);
  assert.equal(dateKey(d),'2026-09-19');
  assert.equal(localInput(d),'2026-09-19T23:45');
  assert.equal(new Date(localInput(d)).getTime(),d.getTime());
});
test('invalid saved formats cannot silently overwrite data',()=>{
  assert.deepEqual(validateState(blank()),blank());
  assert.throws(()=>validateState({version:1}));
  assert.throws(()=>validateState(null));
});
test('rejects malformed records inside an otherwise valid workspace',()=>{
  for(const tasks of [[null],[{...task,due:'invalid'}],[{...task,minutes:-1}],[task,task]]) {
    assert.throws(()=>validateState({...blank(),tasks}));
  }
  assert.throws(()=>validateState({...blank(),exams:[{id:'e',title:'Exam',subject:'Math',date:task.due,topics:[null]}]}));
  assert.deepEqual(validateState({...blank(),tasks:[task]}).tasks,[task]);
});
test('older workspaces load without restoring removed timer data',()=>{
  const old={...blank(),tasks:[task],run:{id:'r',end:now},sessions:[{id:'s'}]};
  const loaded=validateState(old);
  assert.deepEqual(loaded,{...blank(),tasks:[task]});
  assert.equal('run' in loaded,false);
  assert.equal('sessions' in loaded,false);
});
test('tasks are grouped into useful date buckets',()=>{
  const current=new Date('2026-09-20T10:00:00Z');
  assert.equal(taskGroup({...task,due:'2026-09-19T18:00:00Z'},current),'Overdue');
  assert.equal(taskGroup({...task,due:'2026-09-20T18:00:00Z'},current),'Today');
  assert.equal(taskGroup({...task,due:'2026-09-21T18:00:00Z'},current),'Tomorrow');
  assert.equal(taskGroup({...task,due:'2026-09-25T18:00:00Z'},current),'This week');
  assert.equal(taskGroup({...task,due:'2026-10-01T18:00:00Z'},current),'Later');
  assert.equal(taskGroup({...task,done:'2026-09-20T09:00:00Z'},current),'Completed');
});
test('deadline text is short and relative near the deadline',()=>{
  const current=new Date('2026-09-20T10:00:00Z');
  assert.equal(deadlineText({...task,due:'2026-09-20T13:00:00Z'},current),'3h left');
  assert.equal(deadlineText({...task,due:'2026-09-20T08:00:00Z'},current),'2h late');
  assert.equal(deadlineText({...task,due:'2026-09-21T18:00:00Z'},current),'Tomorrow · 18:00');
});
test('task steps are optional, validated and preserved',()=>{
  const stepped={...task,subtasks:[{id:'step-1',title:'Read chapter',done:false},{id:'step-2',title:'Answer questions',done:true}]};
  assert.deepEqual(validateState({...blank(),tasks:[stepped]}).tasks,[stepped]);
  assert.throws(()=>validateState({...blank(),tasks:[{...task,subtasks:[{id:'step-1',title:'Read',done:false},{id:'step-1',title:'Repeat',done:false}]}]}));
  assert.throws(()=>validateState({...blank(),tasks:[{...task,subtasks:[{id:'step-1',title:'Read',done:'yes'}]}]}));
});
