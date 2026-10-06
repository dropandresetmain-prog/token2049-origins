import { Router } from 'express';

/** Public shell only. Private facts are fetched with the customer's evidence scope and kept in memory. */
export function createProofPageRouter(): Router {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  router.get('/', (_req, res) => res.type('html').send(HTML));
  router.get('/app.js', (_req, res) => res.type('application/javascript').send(SCRIPT));
  return router;
}

const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Purchase proof · Commerce Gateway</title><style>
:root{color-scheme:light;font:16px/1.5 system-ui,sans-serif;color:#172438;background:#f5f7fa}
*{box-sizing:border-box}body{margin:0}main{max-width:1120px;margin:auto;padding:40px 28px}
header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #dce2ea;padding-bottom:20px}
.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#586879}h1{font-size:30px;letter-spacing:-.03em;margin:8px 0}h2{font-size:19px;margin:0 0 16px}
p{margin:8px 0;color:#586879}form,.actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:24px 0}
input{border:1px solid #bac5d2;border-radius:6px;padding:11px;font:inherit;width:320px}button{border:1px solid #bac5d2;background:white;color:#172438;border-radius:6px;padding:11px 16px;cursor:pointer;font:inherit}
button[type=submit]{background:#172438;color:white;border-color:#172438}button:focus-visible,input:focus-visible{outline:3px solid #688bdd;outline-offset:3px}
#purchases{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 28px}#purchases button{text-align:left;font-size:14px}
.grid{display:grid;grid-template-columns:1.2fr 1fr;gap:24px}.card{background:white;border:1px solid #dce2ea;border-radius:10px;padding:26px;margin-bottom:20px}
.amount{font-size:34px;font-weight:650;letter-spacing:-.03em}.badge{display:inline-block;font-size:12px;border:1px solid #dce2ea;border-radius:4px;padding:3px 8px;margin-right:6px}
ol{padding:0;list-style:none;margin:0}li{border-left:2px solid #dce2ea;padding:0 0 24px 22px;margin-left:6px;position:relative}li:last-child{padding-bottom:0}li:before{content:'';position:absolute;left:-7px;top:6px;width:12px;height:12px;border-radius:50%;background:#dce2ea;border:2px solid white}
li[data-status=complete]:before{background:#287362}li[data-status=current]:before{background:#356bc3}li[data-status=attention]:before{background:#ad661b}li[data-status=pending]{opacity:.6}
.step-label{font-weight:600}.step-state{font-size:12px;text-transform:uppercase;color:#586879;margin-left:8px}.time{font-size:12px;color:#748395}
dl{margin:0;display:grid;grid-template-columns:130px 1fr;gap:12px;font-size:14px}dt{color:#586879}dd{margin:0;overflow-wrap:anywhere}details{margin-top:24px}summary{cursor:pointer;color:#43566c}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:#f5f7fa;padding:16px}
#status{min-height:24px}#proof[hidden]{display:none}@media(max-width:760px){main{padding:24px 16px}.grid{grid-template-columns:1fr}input{width:100%}form{align-items:stretch}header{align-items:flex-start}.card{padding:20px}dl{grid-template-columns:110px 1fr}}
</style><script src="/proof/app.js" defer></script></head><body><main>
<header><div><div class="eyebrow">Commerce Gateway</div><h1>Purchase proof</h1><p>Follow the approved terms, payment and verified result.</p></div><span class="badge">Demo environments</span></header>
<form id="auth"><label for="token">Evidence access token</label><input id="token" type="password" required autocomplete="off"><button type="submit">Load purchases</button><button id="clear" type="button">Clear session</button></form>
<p id="status" role="status" aria-live="polite">Use a customer token with evidence access. It stays in this page's memory.</p>
<nav id="purchases" aria-label="Customer purchases"></nav><section id="proof" hidden aria-label="Purchase proof"></section>
</main></body></html>`;

const SCRIPT = `(() => {
  const auth = document.getElementById('auth'), input = document.getElementById('token');
  const status = document.getElementById('status'), purchases = document.getElementById('purchases'), root = document.getElementById('proof');
  let token = '', generation = 0, selection = 0;
  const node = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  const amount = m => { const n = m.amountMinor.padStart(m.scale + 1, '0'); return m.currency + ' ' + (m.scale ? n.slice(0, -m.scale) + '.' + n.slice(-m.scale) : n); };
  const time = t => t ? new Date(t).toLocaleString() : '';
  const friendly = s => ({not_started:'Not started',order_created_unpaid:'Order created, unpaid',held:'Held',payment_pending:'Payment pending',paid:'Paid',confirmed:'Confirmed',ticketing:'Ticket being issued',ticketed:'Ticket issued',failed:'Failed',cancelled:'Cancelled',unknown:'Not yet verified',none:'No payment reported',pending:'Pending',authorized:'Authorized',simulated_paid:'Simulated payment',test_balance_paid:'Sandbox balance payment',refunded:'Refunded',not_received:'Not received',submitted:'Submitted',escrow_locked:'Held for purchase',released:'Released',invalid:'Invalid payment'})[s] || s;
  async function get(path) {
    const response = await fetch(path, {headers:{Authorization:'Bearer ' + token},cache:'no-store',redirect:'error'});
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || 'Proof could not be loaded.');
    return body;
  }
  function clear() { token=''; input.value=''; generation++; selection++; purchases.replaceChildren();root.replaceChildren();root.hidden=true; }
  document.getElementById('clear').addEventListener('click', () => {clear();status.textContent='Session cleared.';});
  const row = (dl, label, value) => { dl.append(node('dt',label),node('dd',value)); };
  function render(p) {
    root.replaceChildren(); root.hidden=false;
    const top=node('div',undefined,'card');
    top.append(node('span',p.merchant.environment.toUpperCase(),'badge'),node('span',p.progress.label,'badge'),node('h2',p.summary),node('div',amount(p.commercialAmount),'amount'),node('p','Commercial total · exact approved quote'),node('p',p.progress.message));
    if(p.progress.nextAction) top.append(node('p',p.progress.nextAction));
    const refresh=node('button','Refresh progress');refresh.type='button';refresh.addEventListener('click',()=>load(p.purchaseId));top.append(refresh);root.append(top);
    const grid=node('div',undefined,'grid'), journey=node('div',undefined,'card'), timeline=node('ol');journey.append(node('h2','From request to result'));
    p.timeline.forEach(s=>{const li=node('li');li.dataset.status=s.status;li.append(node('span',s.label,'step-label'),node('span',s.status,'step-state'),node('p',s.text));if(s.timestamp)li.append(node('div',time(s.timestamp),'time'));timeline.append(li);});journey.append(timeline);grid.append(journey);
    const side=node('div'), funding=node('div',undefined,'card'), dl=node('dl'), f=p.funding.requirement, a=f.amount;
    funding.append(node('h2','Payment proof'));row(dl,'Funding rail',f.rail);row(dl,'Network',a.network.toUpperCase());row(dl,'Asset',a.symbol || a.assetId);
    const digits=a.amountBaseUnits.padStart(a.decimals+1,'0');row(dl,'Testnet amount',(a.decimals?digits.slice(0,-a.decimals)+'.'+digits.slice(-a.decimals):digits)+' '+(a.symbol||a.assetId));
    row(dl,'Notional scale',f.settlement?f.settlement.policy.numerator+':'+f.settlement.policy.denominator+' · testnet proof; no market conversion':'Legacy policy; see technical evidence');
    row(dl,'Confirmation',friendly(p.funding.confirmationStatus));row(dl,'Source',p.funding.sources.map(s=>s.displayAddress).join(', ') || 'No payer source recorded yet');
    row(dl,'Reference',p.funding.transfers.map(t=>t.reference+' ('+t.evidenceMode+')').join(', ') || 'No transfer recorded');funding.append(dl);side.append(funding);
    const merchant=node('div',undefined,'card'), md=node('dl');merchant.append(node('h2','Merchant result'));row(md,'Provider',p.merchant.provider);row(md,'Environment',p.merchant.environment.toUpperCase());row(md,'Result',friendly(p.merchant.result));row(md,'Payment',friendly(p.merchant.paymentStatus));row(md,'Provider ref',p.merchant.providerReference || 'No reference recorded');merchant.append(md);side.append(merchant);grid.append(side);root.append(grid);
    const receipt=node('div',undefined,'card');receipt.append(node('h2','Receipt / proof'));
    if(p.receipt){receipt.append(node('p',p.receipt.finalResult+' · '+p.receipt.receiptId),node('p','Issued '+time(p.receipt.issuedAt)));p.receipt.limitations.forEach(l=>receipt.append(node('p',l)));}else receipt.append(node('p','A final receipt is not yet available. The timeline shows the current evidence boundary.'));
    const details=node('details'), summary=node('summary','Technical evidence'), pre=node('pre');details.append(summary,pre);
    details.addEventListener('toggle',async()=>{if(!details.open||pre.textContent)return;const g=generation;try{const body=await get(p.technicalEvidencePath);if(g===generation&&root.contains(details))pre.textContent=JSON.stringify(body,null,2);}catch{if(g===generation)pre.textContent='Technical evidence could not be loaded.';}});receipt.append(details);root.append(receipt);
  }
  async function load(id) {const g=generation,s=++selection;root.replaceChildren();root.hidden=true;status.textContent='Loading proof…';try{const body=await get('/v1/evidence/purchases/'+encodeURIComponent(id)+'/proof');if(g!==generation||s!==selection)return;render(body.proof);status.textContent='';}catch(e){if(g===generation&&s===selection)status.textContent=e.message;}}
  auth.addEventListener('submit',async event=>{event.preventDefault();const next=input.value;clear();token=next;const g=generation;status.textContent='Loading purchases…';try{const body=await get('/v1/evidence/purchases');if(g!==generation)return;(body.purchases||[]).forEach(p=>{const b=node('button',p.category+' · '+amount(p.payable)+' · '+({awaiting_funding:p.paymentState==='not_received'?'Awaiting payment':'Confirming payment',funded_queued:'Purchase queued',executing:'Purchasing',unresolved:'Verifying result',succeeded:'Result recorded',failed:'Needs attention',requires_reauthorization:'New approval needed',expired:'Quote expired'})[p.state]+' · '+p.id.slice(-6));b.type='button';b.addEventListener('click',()=>load(p.id));purchases.append(b);});status.textContent=body.purchases.length?'Choose a purchase to follow its proof.':'No purchases are available for this customer.';}catch(e){if(g===generation){clear();status.textContent=e.message;}}});
})();`;
