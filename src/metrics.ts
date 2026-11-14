export type Labels = Record<string, string | number>;

interface Series {
  labels: Labels;
  value: number;
}

function key(name: string, labels: Labels): string {
  const labelPart = Object.keys(labels)
    .sort()
    .map((label) => `${label}=${JSON.stringify(String(labels[label]))}`)
    .join(",");
  return `${name}{${labelPart}}`;
}

function escapeHelp(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

/**
 * Minimal, dependency-free Prometheus metrics registry. Counters and gauges
 * are rendered in the text exposition format; duration observations are
 * accumulated into sum/count pairs.
 */
export class Metrics {
  private readonly counters = new Map<string, Series>();
  private readonly gauges = new Map<string, Series>();
  private readonly help = new Map<string, string>();
  private readonly startedAt = Date.now();

  describe(name: string, help: string): void {
    this.help.set(name, help);
  }

  inc(name: string, labels: Labels = {}, value = 1): void {
    const k = key(name, labels);
    const current = this.counters.get(k)?.value ?? 0;
    this.counters.set(k, { labels, value: current + value });
  }

  gauge(name: string, value: number, labels: Labels = {}): void {
    this.gauges.set(key(name, labels), { labels, value });
  }

  observeMs(name: string, durationMs: number, labels: Labels = {}): void {
    const sumKey = key(`${name}_milliseconds_sum`, labels);
    const countKey = key(`${name}_milliseconds_count`, labels);
    const sum = this.counters.get(sumKey)?.value ?? 0;
    const count = this.counters.get(countKey)?.value ?? 0;
    this.counters.set(sumKey, { labels, value: sum + durationMs });
    this.counters.set(countKey, { labels, value: count + 1 });
  }

  snapshot(): { counters: Record<string, number>; gauges: Record<string, number> } {
    return {
      counters: Object.fromEntries([...this.counters].map(([k, series]) => [k, series.value])),
      gauges: Object.fromEntries([...this.gauges].map(([k, series]) => [k, series.value])),
    };
  }

  render(): string {
    const lines: string[] = [];

    const formatSeries = (name: string, series: Series): string => {
      const labels = Object.keys(series.labels)
        .sort()
        .map((label) => `${label}="${String(series.labels[label]).replace(/"/g, '\\"')}"`)
        .join(",");
      return `${name}${labels ? `{${labels}}` : ""} ${series.value}`;
    };

    const group = (input: Map<string, Series>): Map<string, Series[]> => {
      const grouped = new Map<string, Series[]>();
      for (const [k, series] of input) {
        const name = k.replace(/\{.*$/, "");
        const list = grouped.get(name) ?? [];
        list.push(series);
        grouped.set(name, list);
      }
      return grouped;
    };

    for (const [name, list] of group(this.counters)) {
      const help = this.help.get(name);
      if (help) lines.push(`# HELP ${name} ${escapeHelp(help)}`);
      lines.push(`# TYPE ${name} counter`);
      for (const series of list) lines.push(formatSeries(name, series));
    }
    for (const [name, list] of group(this.gauges)) {
      const help = this.help.get(name);
      if (help) lines.push(`# HELP ${name} ${escapeHelp(help)}`);
      lines.push(`# TYPE ${name} gauge`);
      for (const series of list) lines.push(formatSeries(name, series));
    }

    lines.push(`# HELP maxima_mcp_uptime_seconds Process uptime in seconds`);
    lines.push(`# TYPE maxima_mcp_uptime_seconds gauge`);
    lines.push(`maxima_mcp_uptime_seconds ${(Date.now() - this.startedAt) / 1000}`);
    return `${lines.join("\n")}\n`;
  }
}
