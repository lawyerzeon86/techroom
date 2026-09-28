import PaymentStatus from './payment-status';

export const dynamic = 'force-dynamic';

export default async function PaymentReturnPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const order = typeof params.order === 'string' ? params.order : '';
  const token = typeof params.token === 'string' ? params.token : '';
  return <PaymentStatus order={order} token={token}/>;
}
