import assert from 'node:assert/strict';
import pg from 'pg';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const base='http://127.0.0.1:3000';
let number;
try{
  const login=await fetch(base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:process.env.ADMIN_PASSWORD})});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie')?.split(';')[0];assert(cookie);
  const products=await (await fetch(base+'/api/products')).json();
  const p=products.find(p=>p.stock>0&&p.price>0);assert(p);
  // Save an unchanged full product through the real authenticated editor API.
  const edit=await fetch(base+'/api/products/'+p.id,{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(p)});
  assert.equal(edit.status,200);
  const stock=(await pool.query('SELECT stock FROM products WHERE id=$1',[p.id])).rows[0].stock;
  const body={customerName:'Автоматическая проверка TechRoom',phone:'+70000000000',deliveryMethod:'pickup',paymentMethod:'cash',comment:'Технический тест: автоматически удаляется',items:[{productId:p.id,quantity:1}]};
  const r=await fetch(base+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await r.json();number=result.orderNumber;assert.equal(r.status,201);assert(number);
  assert.equal(result.totalAmount,p.price);
  assert.equal(Number((await pool.query('SELECT stock FROM products WHERE id=$1',[p.id])).rows[0].stock),Number(stock)-1);
  const crm=await (await fetch(base+'/api/admin/orders',{headers:{Cookie:cookie}})).json();
  const order=crm.orders.find(o=>o.orderNumber===number);assert(order);assert.equal(order.items.length,1);assert.equal(order.totalAmount,p.price);
  const config=await (await fetch(base+'/api/payments/config')).json();
  if(!config.sbpAvailable){
    const qr=await fetch(base+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,paymentMethod:'qr'})});assert.equal(qr.status,503);
  }
  assert.equal((await fetch(base+'/api/admin/orders')).status,401);
  console.log('CHECKOUT_VERIFIED',JSON.stringify({editor:true,order:true,stock:true,crm:true,adminProtected:true,sbp:config.sbpAvailable?'configured_not_charged':'blocked_missing_credentials'}));
}finally{
  if(number){
    const c=await pool.connect();
    try{
      await c.query('BEGIN');
      const o=(await c.query('SELECT id FROM orders WHERE order_number=$1 AND phone=$2 FOR UPDATE',[number,'+70000000000'])).rows[0];
      if(o){
        const items=(await c.query('SELECT product_id,quantity FROM order_items WHERE order_id=$1',[o.id])).rows;
        for(const i of items)await c.query('UPDATE products SET stock=stock+$1 WHERE id=$2',[i.quantity,i.product_id]);
        await c.query('DELETE FROM orders WHERE id=$1',[o.id]);
      }
      await c.query('COMMIT');console.log('CHECKOUT_TEST_DATA_REMOVED');
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  await pool.end();
}
