/* Actual wizard functions exercised with a minimal DOM harness.
   Run: node tests-ui.js. This is not a browser or tax-accuracy audit. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Element {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.attrs={};this.listeners={};this.value='';this.hidden=false;this.open=true;this.style={};this.dataset={};this.classes=new Set();this.classList={add:k=>this.classes.add(k),remove:k=>this.classes.delete(k),toggle:(k,on)=>on?this.classes.add(k):this.classes.delete(k)};}
 set innerHTML(v){this.html=v;this.children=[];} get innerHTML(){return this.html||'';}
 set textContent(v){this.text=String(v);this.children=[];} get textContent(){return this.text||this.children.map(c=>c.textContent).join('');}
 appendChild(c){this.children.push(c);return c;} setAttribute(k,v){this.attrs[k]=v;} removeAttribute(k){delete this.attrs[k];}
 addEventListener(k,f){this.listeners[k]=f;} focus(){this.focused=true;}
 querySelector(q){return this.querySelectorAll(q)[0]||null;}
 querySelectorAll(q){return this.children.flatMap(c=>[...(c.tagName===q?[c]:[]),...c.querySelectorAll(q)]);}
}
const elements=new Map();
for(const m of fs.readFileSync('app/file.html','utf8').matchAll(/id="([^"]+)"/g))elements.set(m[1],new Element());
for(let i=0;i<9;i++){elements.get('p'+i).appendChild(new Element('h2'));elements.get('steps').appendChild(new Element('button'));}
const answers={status:'citizen',ssn:'yes',marital:'single',fulltime:'no',support:'yes',lived:'own',confirmed:'not',aotc:'4',halftime:'no',marketplace:'no',retire:'no',foreign:'no',software:'undecided'};
const radios=new Map();for(const [name,value] of Object.entries(answers)){const e=new Element('input');e.value=value;e.checked=true;radios.set(name,e);}
const compact={matches:true,addEventListener(k,f){this.listener=f;}},reduced={matches:true};
const context=vm.createContext({console,document:{addEventListener(){},getElementById:id=>elements.get(id)||null,createElement:tag=>new Element(tag),querySelectorAll:()=>[],querySelector:q=>{const m=q.match(/input\[name="([^"]+)"\]:checked/);return m?radios.get(m[1])||null:null;}},window:{matchMedia:q=>q.includes('940')?compact:reduced,scrollTo(opts){this.lastScroll=opts;}}});
vm.runInContext(fs.readFileSync('assets/js/tax-constants.js','utf8')+'\n'+fs.readFileSync('assets/js/wizard.js','utf8'),context);
for(const [id,value] of Object.entries({age:'25',homestate:'VA',schoolstate:'VA',workedschool:'no',workedother:'no'}))elements.get(id).value=value;
let passed=0;function test(name,fn){fn();passed++;console.log('PASS '+name);}
test('Mobile summary collapses and responds to desktop resize',()=>{vm.runInContext('wireRail()',context);assert.equal(elements.get('rail-disclosure').open,false);compact.matches=false;compact.listener();assert.equal(elements.get('rail-disclosure').open,true);compact.matches=true;});
test('Navigation updates progress, focus, current step and disabled states',()=>{vm.runInContext('go(2)',context);assert.equal(elements.get('mobile-progress').textContent,'Step 3 of 9 · Dependency');assert.equal(elements.get('p2').hidden,false);assert.equal(elements.get('p1').hidden,true);assert.equal(elements.get('p2').children[0].focused,true);assert.equal(elements.get('steps').children[2].attrs['aria-current'],'step');assert.equal(elements.get('steps').children[3].disabled,true);assert.equal(elements.get('rail-disclosure').open,false);assert.equal(context.window.lastScroll.behavior,'auto');});
test('Returning to final step rebuilds the plan from changed inputs',()=>{elements.get('w2wage').value='20000';vm.runInContext('go(8)',context);const first=elements.get('plan').innerHTML;elements.get('w2wage').value='30000';vm.runInContext('go(4);go(8)',context);assert.notEqual(elements.get('plan').innerHTML,first);assert.ok(elements.get('plan').innerHTML.includes('$1,420'));});
test('Two W-2 samples accumulate and removing one reverses it',()=>{for(const id of ['w2wage','w2fed','w2state'])elements.get(id).value='0';vm.runInContext('handleFiles([{name:"w2-one.pdf",size:100},{name:"w2-two.pdf",size:100}])',context);assert.equal(Number(elements.get('w2wage').value),15680);vm.runInContext('removeFile(A.files[0].id)',context);assert.equal(Number(elements.get('w2wage').value),7840);});
test('Filename markup is rendered as text',()=>{const name='<img onerror=alert(1)>.pdf';vm.runInContext('handleFiles([{name:'+JSON.stringify(name)+',size:100}])',context);const li=elements.get('filelist').children.at(-1);assert.ok(li.textContent.includes(name));assert.equal(li.querySelectorAll('img').length,0);});
console.log(passed+' interaction tests passed. No browser layout or full tax audit performed.');
