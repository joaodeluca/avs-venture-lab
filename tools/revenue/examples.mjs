/** Entirely synthetic closing example. No customer records or measured savings. */
export function demoBundle(scenario='difference'){
 const start='2026-09-01T00:00:00Z',end='2026-10-01T00:00:00Z';
 const contract={schema_version:1,data_class:'SIMULATED',customer_id:'demo_company',currency:'BRL',period_start:start,period_end:end,invoice_cutoff:'2026-10-02T00:00:00Z',pricing:'linear',rounding:'meter_total_half_up',meters:[{meter_id:'api_calls',unit:'call',unit_price:'0.03'},{meter_id:'storage',unit:'GB_day',unit_price:'0.006'}]};
 const event=(id,meter,unit,quantity,day='10',kind='usage',reverses=null)=>({event_id:id,meter_id:meter,unit,kind,quantity,occurred_at:`2026-09-${day}T10:00:00Z`,received_at:`2026-09-${day}T10:01:00Z`,reverses});
 const events={schema_version:1,data_class:'SIMULATED',customer_id:'demo_company',complete:true,events:[event('api_01','api_calls','call','1000'),event('api_02','api_calls','call','250','11'),event('refund_01','api_calls','call','50','12','refund','api_02'),event('storage_01','storage','GB_day','500')]};
 const invoice={schema_version:1,data_class:'SIMULATED',customer_id:'demo_company',currency:'BRL',period_start:start,period_end:end,complete:true,lines:[{line_id:'line_api',meter_id:'api_calls',unit:'call',quantity:'1150',amount:'34.50'},{line_id:'line_storage',meter_id:'storage',unit:'GB_day',quantity:'500',amount:'3.00'}]};
 if(scenario==='matched'){invoice.lines[0].quantity='1200';invoice.lines[0].amount='36.00';}
 if(scenario==='incomplete')events.complete=false;
 if(scenario==='duplicate')events.events.push({...events.events[0]});
 if(scenario==='late')events.events[0].received_at='2026-10-03T10:01:00Z';
 if(scenario==='unit')events.events[0].unit='request';
 return{contract,events,invoice};
}
