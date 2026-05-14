export type RawPageListEntry = {
  id: number | string;
  title?: string;
  url?: string;
  inspectorUrl?: string;
};

export type InspectableView = {
  id: number;
  title: string;
  url: string;
  inspectorUrl: string;
  websocketUrl: string;
};

export type InspectorCommandResponse = {
  id: number;
  result?: unknown;
  error?: {
    code?: number;
    message: string;
    data?: unknown;
  };
};

export type InspectorEvent = {
  method: string;
  params?: unknown;
};

export type InspectorCommandResult = {
  response: InspectorCommandResponse;
  events: InspectorEvent[];
};
