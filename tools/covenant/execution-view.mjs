const names={positive:'FAQ correta',receipt_without_file:'Recibo sem arquivo',wrong_answer:'Resposta divergente',cross_task:'Entrega de outra tarefa',stale_file:'Arquivo anterior à execução',reference_changed:'Fonte alterada'};
try{
 const load=async path=>{const r=await fetch(path);if(!r.ok)throw new Error('Não foi possível ler a evidência publicada.');return r.json();};
 const [faq,report]=await Promise.all([load('execution/example-evidence/positive-faq.json'),load('execution/example-evidence/replay-report.json')]);
 const heading=document.createElement('h3');heading.textContent=faq.title;document.querySelector('#faq').append(heading);
 for(const a of faq.answers){const h=document.createElement('h4'),p=document.createElement('p');h.textContent=a.question;p.textContent=a.answer;document.querySelector('#faq').append(h,p);}
 for(const c of report.cases.filter(c=>Object.hasOwn(names,c.case))){const tr=document.createElement('tr');for(const text of[names[c.case],c.after,c.error_code??(c.failed_checks.join(', ')||'Arquivo lido; critérios correspondem')]){const td=document.createElement('td');td.textContent=text;tr.append(td);}tr.children[1].className=c.after==='LOCAL_ARTIFACT_MATCH'?'ok':'bad';document.querySelector('#controls').append(tr);}
}catch(error){document.querySelector('#error').textContent=error.message;}
