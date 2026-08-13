import { useLocation, useNavigate, useParams, useSearchParams } from '@solidjs/router';
import { type Component } from 'solid-js';
import { WidgetDetailPage } from '@/shell/framework/feature/sidebar';
import { createFrontendSidebarController } from '@/shell/chat/adapters';
import { useFrontendRuntime } from '../runtime-context';

const WidgetPage: Component = () => {
  const params = useParams<{ source: string; name: string }>();
  const runtime = useFrontendRuntime();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const controller = createFrontendSidebarController(runtime, { pathname: () => location.pathname, navigate });
  const source = (): 'published' | 'draft' | null => params.source === 'published' || params.source === 'draft' ? params.source : null;
  const name = () => {
    try { return decodeURIComponent(params.name); } catch { return null; }
  };
  return <WidgetDetailPage
    source={source()}
    name={name()}
    controller={controller}
    query={{
      tab: () => typeof searchParams.tab === 'string' ? searchParams.tab : undefined,
      path: () => typeof searchParams.path === 'string' ? searchParams.path : undefined,
      set: (values, options) => setSearchParams(values, options),
    }}
  />;
};

export default WidgetPage;
