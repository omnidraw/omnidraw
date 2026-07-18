import { useParams } from '@solidjs/router';
import type { TWidgetSource } from '@vibecanvas/orpc-client';
import { type Component } from 'solid-js';
import { WidgetDetailPage } from '@/feature/widgets/WidgetDetailPage';

const WidgetPage: Component = () => {
  const params = useParams<{ source: string; name: string }>();
  const source = (): TWidgetSource | null => params.source === 'published' || params.source === 'draft' ? params.source : null;
  const name = () => {
    try { return decodeURIComponent(params.name); } catch { return null; }
  };
  return <WidgetDetailPage source={source()} name={name()} />;
};

export default WidgetPage;
