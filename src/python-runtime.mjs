import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

// RestrictedPython is a language policy, not an OS sandbox. No credentials are inherited.
const WORKER=String.raw`
import sys, json, operator
sys.path.insert(0, sys.argv[1])
from RestrictedPython import compile_restricted
from RestrictedPython.Guards import safe_builtins, safer_getattr_raise, guarded_iter_unpack_sequence, guarded_unpack_sequence, full_write_guard
from importlib.metadata import version
if version('RestrictedPython') != '8.5':
    raise RuntimeError('Requires RestrictedPython 8.5')
try:
    import resource
    resource.setrlimit(resource.RLIMIT_AS, (256*1024*1024, 256*1024*1024))
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
except ImportError:
    if sys.platform != 'win32': raise RuntimeError('Unsupported Python resource limits')
    import ctypes
    from ctypes import wintypes
    class BasicLimits(ctypes.Structure):
        _fields_=[('process_time',ctypes.c_int64),('job_time',ctypes.c_int64),('flags',wintypes.DWORD),('min_work',ctypes.c_size_t),('max_work',ctypes.c_size_t),('active',wintypes.DWORD),('affinity',ctypes.c_size_t),('priority',wintypes.DWORD),('scheduling',wintypes.DWORD)]
    class Counters(ctypes.Structure):
        _fields_=[(name,ctypes.c_uint64) for name in ['read_ops','write_ops','other_ops','read_bytes','write_bytes','other_bytes']]
    class Limits(ctypes.Structure):
        _fields_=[('basic',BasicLimits),('io',Counters),('process_memory',ctypes.c_size_t),('job_memory',ctypes.c_size_t),('peak_process',ctypes.c_size_t),('peak_job',ctypes.c_size_t)]
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.CreateJobObjectW.argtypes=[ctypes.c_void_p,wintypes.LPCWSTR];kernel.CreateJobObjectW.restype=wintypes.HANDLE
    kernel.GetCurrentProcess.restype=wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes=[wintypes.HANDLE,ctypes.c_int,ctypes.c_void_p,wintypes.DWORD];kernel.SetInformationJobObject.restype=wintypes.BOOL
    kernel.AssignProcessToJobObject.argtypes=[wintypes.HANDLE,wintypes.HANDLE];kernel.AssignProcessToJobObject.restype=wintypes.BOOL
    limits=Limits();limits.basic.flags=0x100|0x2;limits.basic.process_time=100000000;limits.process_memory=256*1024*1024
    job=kernel.CreateJobObjectW(None,None)
    if not job or not kernel.SetInformationJobObject(job,9,ctypes.byref(limits),ctypes.sizeof(limits)) or not kernel.AssignProcessToJobObject(job,kernel.GetCurrentProcess()):
        raise RuntimeError('Cannot establish Windows Python job limits')
class EvidencePage:
    def __init__(self, token): self.token = token
    def __str__(self): raise TypeError('Emit evidence pages directly; do not stringify pages')
    __repr__ = __str__
def send(value):
    raw=json.dumps(value,ensure_ascii=True,separators=(',',':'))
    if len(raw)>200000: raise ValueError('Python RPC message exceeds limit')
    sys.stdout.write(raw+'\n');sys.stdout.flush()
def pack(v,depth=0):
    if depth>24: raise ValueError('Python output nesting limit')
    if isinstance(v,EvidencePage): return {'page':v.token}
    def clean(x,d=0):
        if d>24: raise ValueError('Python output nesting limit')
        if isinstance(x,EvidencePage): raise TypeError('Emit evidence pages directly')
        if isinstance(x,dict): return {k:clean(v,d+1) for k,v in x.items()}
        if isinstance(x,(list,tuple)): return [clean(v,d+1) for v in x]
        if x is None or isinstance(x,(str,int,float,bool)): return x
        raise TypeError('Only JSON values or a direct evidence page may be emitted')
    return {'value':clean(v)}
def rpc(name,value):
    send({'op':name,'arg':pack(value)})
    raw=sys.stdin.readline(200001)
    if len(raw)>200000: raise ValueError('Python RPC response exceeds limit')
    result=json.loads(raw)
    if 'error' in result: raise RuntimeError(result['error'])
    if 'page' in result: return EvidencePage(result['page'])
    return result.get('value')
def operation(name):
    def call(arg=None,**kw):
        if arg is not None and kw: raise TypeError('Pass one dictionary or keyword arguments')
        if arg is None: arg=kw
        elif isinstance(arg,str): arg={('query' if name in ('search','history') else 'ref' if name=='recall' else 'path'):arg}
        return rpc(name,arg)
    return call
def get_attr(obj,name):
    if isinstance(obj,EvidencePage): raise TypeError('Opaque evidence page; emit it directly')
    return safer_getattr_raise(obj,name)
def inplace(op,left,right):
    methods={'+=':operator.iadd,'-=':operator.isub,'*=':operator.imul,'/=':operator.itruediv,'//=':operator.ifloordiv,'%=':operator.imod,'**=':operator.ipow,'&=':operator.iand,'|=':operator.ior,'^=':operator.ixor,'<<=':operator.ilshift,'>>=':operator.irshift}
    return methods[op](left,right)
def get_item(obj,key):
    if isinstance(obj,EvidencePage): raise TypeError('Opaque evidence page; emit it directly')
    return obj[key]
class PrintSink:
    def __init__(self,*args): pass
    def _call_print(self,*values,sep=' ',end='\n',**kw):
        if kw: raise TypeError('print supports values, sep and end only')
        if len(values)==1 and isinstance(values[0],EvidencePage): return rpc('emit',values[0])
        if any(isinstance(v,EvidencePage) for v in values): raise TypeError('Emit evidence pages directly')
        return rpc('emit',sep.join(str(v) for v in values))
    def __call__(self): return ''
steps=0
def trace(frame,event,arg):
    global steps
    if frame.f_code.co_filename=='retrieval.py':
        frame.f_trace_opcodes=True
        steps+=1
        if steps>30000: raise RuntimeError('Python execution operation limit')
    return trace
builtins=dict(safe_builtins)
for key in ['BaseException','__build_class__','setattr','delattr']: builtins.pop(key,None)
builtins.update({'list':list,'dict':dict,'set':set,'tuple':tuple,'enumerate':enumerate,'zip':zip,'sorted':sorted,'sum':sum,'min':min,'max':max,'any':any,'all':all,'reversed':reversed})
namespace={'__builtins__':builtins,'_inplacevar_':inplace,'_print_':PrintSink,'_getattr_':get_attr,'_getitem_':get_item,'_getiter_':iter,'_write_':full_write_guard,'_iter_unpack_sequence_':guarded_iter_unpack_sequence,'_unpack_sequence_':guarded_unpack_sequence}
for name,op in [('search','search'),('list_files','list'),('read','read'),('read_hit','readHit'),('history','history'),('recall','recall')]: namespace[name]=operation(op)
namespace['emit']=lambda value:rpc('emit',value)
try:
    program=json.loads(sys.stdin.readline(40001))['code']
    compiled=compile_restricted(program,'retrieval.py','exec')
    sys.settrace(trace)
    exec(compiled,namespace)
    sys.settrace(None)
    send({'done':True})
except BaseException as error:
    sys.settrace(None)
    send({'failed':type(error).__name__+': '+str(error)[:500]})
`;

export async function runPythonRetrieval(code,api,{check=()=>{},isPage=()=>false,signal,timeoutMs=15000,python=process.env.TEA_PYTHON_EXECUTABLE||'python',dependencies=process.env.TEA_PYTHON_DEPS||path.resolve('.tea/python-runtime')}={}){
  if(typeof code!=='string'||!code.trim()||code.length>6000)throw Error('Retrieval code must be 1..6000 characters');
  check();signal?.throwIfAborted();
  const env={};for(const key of ['SystemRoot','SYSTEMROOT','WINDIR','PATH','Path','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];
  const child=spawn(python,['-I','-S','-B','-X','utf8','-u','-c',WORKER,path.resolve(dependencies)],{cwd:os.tmpdir(),env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const pages=new Map();let fatal,done=false,bytes=0,stderr='',active=Promise.resolve();
  const fail=error=>{fatal??=error;child.kill();};
  const abort=()=>fail(signal.reason||Error('Python retrieval aborted'));
  signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>fail(Error('Python execution time limit')),timeoutMs);
  const lines=createInterface({input:child.stdout});
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>250000)fail(Error('Python RPC output limit'));});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(0,1500);});
  child.stdin.on('error',error=>{if(!done&&!fatal)fail(error);});
  const ended=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,termination)=>resolve({code,termination}));});
  lines.on('line',line=>{
    active=active.then(async()=>{
      if(fatal)return;
      check();let message;try{message=JSON.parse(line);}catch{throw Error('Invalid Python RPC message');}
      if(message.failed)throw Error(message.failed);
      if(message.done){done=true;return;}
      if(done||!['search','list','read','readHit','history','recall','emit'].includes(message.op))throw Error('Invalid Python retrieval operation');
      const arg=message.arg;let value;
      if(arg&&Object.hasOwn(arg,'page')){if(!pages.has(arg.page))throw Error('Invalid evidence page');value=pages.get(arg.page);}
      else if(arg&&Object.hasOwn(arg,'value'))value=arg.value;else throw Error('Invalid Python RPC argument');
      let result;
      try{result=await api(message.op,[value]);check();}catch(e){fatal=e;child.kill();return;}
      let reply;
      if(isPage(result)){const id=randomUUID();pages.set(id,result);reply={page:id};}else reply={value:result};
      if(!child.killed)child.stdin.write(JSON.stringify(reply)+'\n');
    }).catch(fail);
  });
  child.stdin.write(JSON.stringify({code})+'\n');
  try{const result=await ended;await active;check();if(fatal)throw fatal;if(!done||result.code!==0)throw Error('Python worker failed: '+(stderr||result.termination||result.code));}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);lines.close();child.stdin.destroy();if(!child.killed)child.kill();await active;}
}
