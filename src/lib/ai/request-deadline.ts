import {ToolError} from '@/lib/errors';

// The deadline covers headers AND body consumption; clearing a timer as soon as
// fetch returns would leave response.json()/text() able to hang indefinitely.
export async function withRequestDeadline<T>(label:string, milliseconds:number, run:(signal:AbortSignal)=>Promise<T>):Promise<T> {
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>{
      controller.abort();
      reject(new ToolError('TRANSIENT',`${label} timed out after ${milliseconds/1000} seconds.`));
    },milliseconds);
  });
  try { return await Promise.race([run(controller.signal),timeout]); }
  catch(error) {
    if(controller.signal.aborted) throw new ToolError('TRANSIENT',`${label} timed out after ${milliseconds/1000} seconds.`);
    throw error;
  }
  finally { clearTimeout(timer); }
}
