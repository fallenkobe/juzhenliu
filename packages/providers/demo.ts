import type { JobState } from '../domain/types';

/** Intentionally contains no HTTP client or real credential support. */
export const demoProvider = {
  async publish(id: string, scenario: string): Promise<{ state: JobState; externalId: string | null; error: string | null }> {
    await new Promise(r => setTimeout(r, 120));
    if (scenario === 'unknown') return { state:'UNKNOWN',externalId:null,error:'演示：提交后连接中断，结果未知；请核验原任务，不要重复发布。' };
    if (scenario === 'rejected') return { state:'FAILED_CONFIRMED',externalId:null,error:'演示：内容审核拒绝，已确认没有发表。' };
    return {state:'ACCEPTED',externalId:'demo_publish_'+id,error:null};
  },
  async promote(id: string, scenario: string) {
    await new Promise(r => setTimeout(r, 120));
    return { scenario, externalId: scenario==='unknown'?null:'demo_order_'+id };
  }
};
