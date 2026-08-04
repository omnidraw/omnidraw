import { useLocation, useNavigate, useParams, useSearchParams } from '@solidjs/router';
import { type Component } from 'solid-js';
import { WidgetDetailPage } from '@omnidraw/ui-ai-chat';
import { createFrontendSidebarController } from '@/ai-chat-adapters';

const WidgetPage: Component = () => {
  const params = useParams<{ source: string; name: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const controller = createFrontendSidebarController({ pathname: () => location.pathname, navigate });
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
