interface EnvironmentActivityProps {
  created_at?: string;
  last_user_action_at?: string | null;
}

export default function EnvironmentActivity({ created_at, last_user_action_at }: EnvironmentActivityProps) {
  return (
    <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs text-gray-500 sm:grid-cols-2">
      <div>
        <dt className="font-medium">Created</dt>
        <dd>{created_at ? <time dateTime={created_at}>{new Date(created_at).toLocaleString()}</time> : 'Not recorded'}</dd>
      </div>
      <div>
        <dt className="font-medium">Last recorded user action</dt>
        <dd>{last_user_action_at ? <time dateTime={last_user_action_at}>{new Date(last_user_action_at).toLocaleString()}</time> : 'No action recorded'}</dd>
      </div>
    </dl>
  );
}
