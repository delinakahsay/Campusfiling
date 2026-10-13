/* Wizard functions exercised with a minimal DOM harness.
   Run: node tests-ui.js. Not a browser or tax-accuracy audit. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Element {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.attrs={};this.listeners={};this.value='';this.hidden=false;this.open=true;this.style={};this.dataset={};this.checked=false;this.classes=new Set();this.classList={add:k=>this.classes.add(k),remove:k=>this.classes.delete(k),toggle:(k,on)=>on?this.classes.add(k):this.classes.delete(k),contains:k=>this.classes.has(k)};}
 set innerHTML(v){this.html=v;this.children=[];} get innerHTML(){return this.html||'';}
 set textContent(v){this.text=String(v);this.children=[];} get textContent(){return this.text||this.children.map(c=>c.textContent).join('');}
 set className(v){this.classes=new Set(String(v).split(/\s+/).filter(Boolean));} get className(){return [...this.classes].join(' ');}
 appendChild(c){this.children.push(c);return c;} setAttribute(k,v){this.attrs[k]=v;} removeAttribute(k){delete this.attrs[k];}
 addEventListener(k,f){(this.listeners[k]=this.listeners[k]||[]).push(f);}
 dispatchEvent(e){(this.listeners[e.type]||[]).forEach(f=>f(e));return true;}
 focus(){this.focused=true;} scrollIntoView(){this.scrolled=true;}
 querySelector(q){return this.querySelectorAll(q)[0]||null;}
 querySelectorAll(q){return this.children.flatMap(c=>[...(c.tagName===q?[c]:[]),...c.querySelectorAll(q)]);}
}
const elements=new Map();
for(const m of fs.readFileSync('app/file.html','utf8').matchAll(/id="([^"]+)"/g))elements.set(m[1],new Element());
for(let i=0;i<9;i++){elements.get('p'+i).appendChild(new Element('h2'));elements.get('steps').appendChild(new Element('button'));}
const answers={status:'citizen',ssn:'yes',marital:'single',fulltime:'yes',support:'no',lived:'parents',confirmed:'claiming',aotc:'0',halftime:'yes',marketplace:'no',retire:'no',foreign:'no',software:'freetaxusa'};
const radios=new Map();for(const [name,value] of Object.entries(answers)){const e=new Element('input');e.value=value;e.checked=true;radios.set(name,e);}
const havedocs=['w2','1099nec','1098t','1099b','1099int','1098e','1095a','stipend','prior'].map(v=>{const e=new Element('input');e.value=v;return e;});
const compact={matches:true,addEventListener(k,f){this.listener=f;}},reduced={matches:true};
function qsa(q){
  if(q==='input[name="havedoc"]')return havedocs;
  if(q==='input[name="havedoc"]:checked')return havedocs.filter(e=>e.checked);
  const m=q.match(/input\[name="([^"]+)"\]:checked/);
  if(m)return radios.has(m[1])&&radios.get(m[1]).checked?[radios.get(m[1])]:[];
  return [];
}
const context=vm.createContext({console,Event:class{constructor(t){this.type=t;}},document:{addEventListener(){},getElementById:id=>elements.get(id)||null,createElement:t=>new Element(t),querySelectorAll:qsa,querySelector:q=>qsa(q)[0]||null},window:{matchMedia:q=>q.includes('940')?compact:reduced,scrollTo(o){this.lastScroll=o;},print(){this.printed=true;}}});
vm.runInContext(fs.readFileSync('assets/js/tax-constants.js','utf8')+'\n'+fs.readFileSync('assets/js/wizard.js','utf8'),context);
for(const [id,value] of Object.entries({age:'20',homestate:'VA',schoolstate:'DC',workedschool:'yes',workedother:'no'}))elements.get(id).value=value;
let passed=0;function test(n,f){f();passed++;console.log('PASS '+n);}

test('Ages render as counts, not currency',()=>{
  const el=new Element('span');el.dataset.tax='studentAgeLimit';
  vm.runInContext('(function(el){const k=el.dataset.tax;if(TAX_COUNT_KEYS.indexOf(k)>-1){el.textContent=String(TAX[k]);}else{el.textContent=money(TAX[k]);}})',context)(el);
  assert.equal(el.textContent,'24');assert.ok(!el.textContent.includes('$'));
});

test('Practice figures load and are labelled as invented',()=>{
  vm.runInContext('loadDemoFigures()',context);
  assert.equal(Number(elements.get('w2wage').value),7840);
  assert.ok(elements.get('extract-note').textContent.includes('invented'));
  assert.equal(elements.get('extract-note').hidden,false);
});

test('Extracted amounts wait in review and never self-apply',()=>{
  elements.get('w2wage').value='';
  vm.runInContext(`pending=[{fileId:1,fileName:'w2.pdf',formType:'W-2',field:'w2wage',label:'Box 1',value:9000}];
    A.files=[{id:1,name:'w2.pdf',size:100,status:'found',applied:{}}];renderReview()`,context);
  assert.equal(elements.get('review').hidden,false,'review table shows');
  assert.equal(elements.get('w2wage').value,'','nothing applied yet');
  assert.ok(elements.get('review').innerHTML.includes('Check these against your forms'));
});

test('Applying review writes the value and removing the file reverses it',()=>{
  const checks=new Map([['0',{checked:true}]]);
  const vals=new Map([['0',{value:'9000'}]]);
  const prevQS=context.document.querySelector;
  context.document.querySelector=q=>{
    let m=q.match(/\[data-review="(\d+)"\]/); if(m)return checks.get(m[1]);
    m=q.match(/\[data-reviewval="(\d+)"\]/); if(m)return vals.get(m[1]);
    return prevQS(q);
  };
  vm.runInContext('applyReview()',context);
  assert.equal(Number(elements.get('w2wage').value),9000);
  vm.runInContext('removeFile(1)',context);
  assert.equal(elements.get('w2wage').value,'','file removal reverses what it applied');
  context.document.querySelector=prevQS;
});

/* Two banks means two 1099-INTs and the interest adds up. Interest used
   to replace rather than accumulate, so the second document silently
   erased the first and the student saw only the last figure. */
test('Two 1099-INTs add together instead of overwriting each other',()=>{
  elements.get('interest').value='';
  vm.runInContext(`pending=[
      {fileId:11,fileName:'capitalone.pdf',formType:'1099-INT',field:'interest',label:'Box 1',value:13.1,confidence:'high'},
      {fileId:12,fileName:'ally.pdf',formType:'1099-INT',field:'interest',label:'Box 1',value:86.4,confidence:'high'}];
    A.files=[{id:11,name:'capitalone.pdf',size:100,status:'found',applied:{}},
             {id:12,name:'ally.pdf',size:120,status:'found',applied:{}}];renderReview()`,context);
  const checks=new Map([['0',{checked:true}],['1',{checked:true}]]);
  const vals=new Map([['0',{value:'13.1'}],['1',{value:'86.4'}]]);
  const prevQS=context.document.querySelector;
  context.document.querySelector=q=>{
    let m=q.match(/\[data-review="(\d+)"\]/); if(m)return checks.get(m[1]);
    m=q.match(/\[data-reviewval="(\d+)"\]/); if(m)return vals.get(m[1]);
    return prevQS(q);
  };
  vm.runInContext('applyReview()',context);
  assert.equal(Number(elements.get('interest').value).toFixed(2),'99.50',
    'both 1099s should be in the box, not just the last one');
  vm.runInContext('removeFile(12)',context);
  assert.equal(Number(elements.get('interest').value).toFixed(2),'13.10',
    'removing the second leaves exactly the first');
  context.document.querySelector=prevQS;
});

/* A figure the reader is unsure of should not arrive pre-ticked. */
test('A low confidence figure arrives unticked',()=>{
  vm.runInContext(`pending=[{fileId:21,fileName:'scan.pdf',formType:'W-2',field:'w2fed',label:'Box 2',value:111,confidence:'low'}];
    A.files=[{id:21,name:'scan.pdf',size:100,status:'found',applied:{}}];renderReview()`,context);
  const html=elements.get('review').innerHTML;
  const row=html.match(/<input type="checkbox" data-review="0"([^/]*)\/>/);
  assert.ok(row,'the review row should render');
  assert.ok(!/checked/.test(row[1]),'a low confidence row must not be pre-ticked');
  assert.ok(/left unticked/i.test(html),'and the banner should say so');
});

test('Stipend beyond qualified expenses becomes taxable scholarship income',()=>{
  elements.get('scholarship').value='0';elements.get('tuition').value='1000';
  elements.get('books').value='0';elements.get('stipend').value='5000';
  const d=vm.runInContext('collect();derive()',context);
  assert.equal(d.taxableStipend,4000);
  assert.equal(d.taxableScholarship,4000);
});

test('Stipend sheltered by unused education expenses is not taxed',()=>{
  elements.get('tuition').value='20000';elements.get('scholarship').value='0';elements.get('stipend').value='5000';
  const d=vm.runInContext('collect();derive()',context);
  assert.equal(d.taxableStipend,0);
});

test('Worksheet is software specific and names the dependent step',()=>{
  elements.get('stipend').value='0';elements.get('scholarship').value='31200';elements.get('tuition').value='28450';elements.get('books').value='900';
  vm.runInContext('buildWorksheet()',context);
  const html=elements.get('worksheet').innerHTML;
  assert.equal(elements.get('worksheet').hidden,false);
  assert.ok(html.includes('Personal Information'),'uses FreeTaxUSA screen names');
  assert.ok(html.includes('Check the dependent box'));
  assert.ok(html.includes('Schedule 1, line 8r'));
});

test('Nonresidents get a refusal instead of a 1040 worksheet',()=>{
  radios.get('status').value='nra';
  vm.runInContext('buildWorksheet()',context);
  const html=elements.get('worksheet').innerHTML;
  assert.ok(html.includes('1040-NR'));
  assert.ok(!html.includes('Check the dependent box'));
  radios.get('status').value='citizen';
});

test('DC work by a Virginia resident is a refund claim, not a nonresident return',()=>{
  const d=vm.runInContext('collect();derive()',context);
  assert.equal(d.states.nonresident.length,0,'no DC nonresident return');
  assert.equal(d.states.refundOnly.join(','),'DC','DC is a D-40B refund claim');
});

test('Checked documents mark themselves off the gathering list',()=>{
  elements.get('w2wage').value='7840';
  havedocs.forEach(e=>{e.checked=e.value==='w2';});
  vm.runInContext('collect();buildPlan()',context);
  const plan=elements.get('plan').innerHTML;
  assert.ok(plan.includes('You have this.'),'W-2 shows as already held');
});

console.log(passed+' interaction tests passed. No browser layout or full tax audit performed.');
