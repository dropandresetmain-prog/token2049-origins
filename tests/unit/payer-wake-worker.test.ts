import {describe,it,expect,vi} from 'vitest';
import {createWakeHandler, WAKE_UPSTREAM_TIMEOUT_MS, type WakeEnv} from '../../deploy/payer-wake/worker.js';
const SECRET='a'.repeat(64), URL='https://capsule-payer-wake-experiment.dropandreset-main.workers.dev/wake';
const env=():WakeEnv=>({CAPSULE_WAKE_SECRET:SECRET,WAKE_RATE_LIMITER:{limit:vi.fn(async()=>({success:true}))}});
const request=(overrides:RequestInit={})=>new Request(URL,{method:'POST',headers:{authorization:'Bearer '+SECRET},...overrides});
function harness(response:()=>Promise<Response> = async()=>Response.json({ok:true})) { const outbound=vi.fn(response);const logs:Array<Record<string,unknown>>=[];return {outbound,logs,worker:createWakeHandler({fetch:outbound as typeof fetch,log:e=>logs.push(e)})}; }
describe('fixed Render health wake Worker',()=>{
 it.each([
 ['missing authorization',()=>request({headers:{}}),401],
 ['wrong authorization',()=>request({headers:{authorization:'Bearer '+'b'.repeat(64)}}),401],
 ['arbitrary URL',()=>new Request(URL+'?url=https://elsewhere.example/pay',{method:'POST'}),404],
 ['payment route',()=>new Request(URL.replace('/wake','/pay'),{method:'POST'}),404],
 ['wrong method',()=>new Request(URL),404],
 ['browser origin',()=>request({headers:{authorization:'Bearer '+SECRET,origin:'https://example.com'}}),400],
 ['body',()=>request({body:'{}'}),400],
 ['wrong host',()=>new Request(URL.replace('capsule-payer-wake-experiment','other'),{method:'POST'}),404],
 ])('refuses %s without outbound traffic',async(_label,make,status)=>{const h=harness();expect((await h.worker.fetch(make(),env())).status).toBe(status);expect(h.outbound).not.toHaveBeenCalled();});
 it('fails closed when secret or limiter is absent',async()=>{const h=harness();for(const e of [{},{CAPSULE_WAKE_SECRET:SECRET}] as WakeEnv[])expect((await h.worker.fetch(request(),e)).status).toBe(503);expect(h.outbound).not.toHaveBeenCalled();});
 it('accepts a zero-byte stream with Content-Length:0 as workerd delivers it',async()=>{const h=harness();const body=new ReadableStream({start(c){c.close();}});const r=await h.worker.fetch(request({body,headers:{authorization:'Bearer '+SECRET,'content-length':'0'},...{duplex:'half'}} as RequestInit),env());expect(r.status).toBe(200);expect(h.outbound).toHaveBeenCalledTimes(1);});
 it('rejects an authenticated chunked body after one bounded read',async()=>{const h=harness();const body=new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));}});expect((await h.worker.fetch(request({body,...{duplex:'half'}} as RequestInit),env())).status).toBe(400);expect(h.outbound).not.toHaveBeenCalled();});
 it('rejects a stalled body without outbound traffic',async()=>{vi.useFakeTimers();try{const h=harness();const body=new ReadableStream();const pending=h.worker.fetch(request({body,...{duplex:'half'}} as RequestInit),env());await vi.advanceTimersByTimeAsync(1001);expect((await pending).status).toBe(400);expect(h.outbound).not.toHaveBeenCalled();}finally{vi.useRealTimers();}});
 it('uses exactly one fixed unauthenticated GET and forwards no upstream secrets or body',async()=>{const h=harness(async()=>new Response('PRIVATE BODY',{status:200,headers:{'content-type':'text/html','x-private':'PRIVATE HEADER','x-render-routing':'PRIVATE ROUTING'}}));const r=await h.worker.fetch(request(),env());expect(r.status).toBe(200);expect(h.outbound).toHaveBeenCalledTimes(1);const [url,init]=h.outbound.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe('https://t2o-cardano-payer.onrender.com/health');expect(init).toMatchObject({method:'GET',redirect:'manual',credentials:'omit'});expect(new Headers(init.headers).has('authorization')).toBe(false);expect(init.signal).toBeInstanceOf(AbortSignal);const text=await r.text();expect(text).toContain('upstream_2xx');for(const x of ['PRIVATE',SECRET,'Bearer']){expect(text).not.toContain(x);expect(JSON.stringify(h.logs)).not.toContain(x);}expect(r.headers.get('cache-control')).toBe('no-store');});
 it('classifies hibernation refusal without retrying',async()=>{const h=harness(async()=>new Response('edge',{status:429,headers:{'x-render-routing':'hibernate-rate-limited'}}));const r=await h.worker.fetch(request(),env());expect(r.status).toBe(503);expect(await r.json()).toMatchObject({upstreamStatus:429,renderRouting:'hibernate-rate-limited',paymentAttempted:false});expect(h.outbound).toHaveBeenCalledTimes(1);});
 it('refuses redirects without following them',async()=>{const h=harness(async()=>new Response(null,{status:302,headers:{location:'https://example.com/pay'}}));expect(await(await h.worker.fetch(request(),env())).json()).toMatchObject({category:'redirect_refused'});expect(h.outbound).toHaveBeenCalledTimes(1);});
 it('coalesces concurrent authorized calls within one isolate',async()=>{let finish!:(r:Response)=>void;const h=harness(()=>new Promise(r=>{finish=r;}));const e=env();const first=h.worker.fetch(request(),e),second=h.worker.fetch(request(),e);await vi.waitFor(()=>expect(h.outbound).toHaveBeenCalledTimes(1));finish(Response.json({ok:true}));const responses=await Promise.all([first,second]);expect(responses.every(r=>r.status===200)).toBe(true);expect(h.outbound).toHaveBeenCalledTimes(1);});
 it('limits replayed authorization before outbound traffic',async()=>{const h=harness();const e=env();e.WAKE_RATE_LIMITER!.limit=vi.fn(async()=>({success:false}));expect((await h.worker.fetch(request(),e)).status).toBe(429);expect(h.outbound).not.toHaveBeenCalled();});
 it('fails closed when rate limiting is unavailable',async()=>{const h=harness();const e=env();e.WAKE_RATE_LIMITER!.limit=vi.fn(async()=>{throw Error('PRIVATE');});expect((await h.worker.fetch(request(),e)).status).toBe(503);expect(h.outbound).not.toHaveBeenCalled();});
 it('sanitizes network/timeout errors and never retries',async()=>{const h=harness(async()=>{throw new DOMException('PRIVATE','TimeoutError');});const r=await h.worker.fetch(request(),env());expect(await r.json()).toMatchObject({category:'timeout',paymentAttempted:false});expect(h.outbound).toHaveBeenCalledTimes(1);expect(JSON.stringify(h.logs)).not.toContain('PRIVATE');});
 it('returns a terminal upstream timeout before the independent caller cancels',async()=>{
  vi.useFakeTimers();
  const timers:Array<ReturnType<typeof setTimeout>>=[];
  const timeout=vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{
   const controller=new AbortController();timers.push(setTimeout(()=>controller.abort(new DOMException('deadline','TimeoutError')),ms));return controller.signal;
  });
  try{
   const caller=AbortSignal.timeout(110_000),logs:Array<Record<string,unknown>>=[];
   const outbound=vi.fn(async(_url:Parameters<typeof fetch>[0],init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true})));
   const worker=createWakeHandler({fetch:outbound as typeof fetch,log:e=>logs.push(e)});
   const pending=worker.fetch(request({signal:caller}),env());
   await vi.advanceTimersByTimeAsync(89_999);expect(caller.aborted).toBe(false);expect(logs).toHaveLength(0);
   await vi.advanceTimersByTimeAsync(1);const response=await pending;
   expect(response.status).toBe(503);expect(await response.json()).toMatchObject({category:'timeout',durationMs:90_000,paymentAttempted:false});
   expect(caller.aborted).toBe(false);expect(outbound).toHaveBeenCalledTimes(1);expect(logs).toHaveLength(1);expect(logs[0]).toMatchObject({type:'capsule_payer_wake',category:'timeout'});
   expect(timeout).toHaveBeenCalledWith(WAKE_UPSTREAM_TIMEOUT_MS);
  }finally{for(const timer of timers)clearTimeout(timer);timeout.mockRestore();vi.useRealTimers();}
 });
 it('reports a terminal transport failure without leaking its exception or retrying',async()=>{
  const h=harness(async()=>{throw new TypeError('PRIVATE CONNECTION DETAILS');});const response=await h.worker.fetch(request(),env());
  expect(response.status).toBe(503);expect(await response.json()).toMatchObject({category:'transport_error',paymentAttempted:false});
  expect(h.outbound).toHaveBeenCalledTimes(1);expect(h.logs).toHaveLength(1);expect(JSON.stringify(h.logs)).not.toContain('PRIVATE');
 });

});
