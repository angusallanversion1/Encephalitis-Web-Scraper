import React from 'react';
import { CheckCircle, Circle, Loader2, XCircle, ExternalLink } from 'lucide-react';
import { ProcessingStatus } from '../types';

interface ProcessListProps {
  items: ProcessingStatus[];
}

export const ProcessList: React.FC<ProcessListProps> = ({ items }) => {
  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[500px]">
      <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
        <h3 className="font-medium text-slate-700">Processing Queue</h3>
        <span className="text-xs text-slate-500">{items.length} Items</span>
      </div>
      <div className="overflow-y-auto flex-1 p-0">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0">
            <tr>
              <th className="px-4 py-2 w-16">Status</th>
              <th className="px-4 py-2">URL</th>
              <th className="px-4 py-2">Classification</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => (
              <tr key={item.url} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3">
                  {item.status === 'pending' && <Circle className="w-4 h-4 text-slate-300" />}
                  {item.status === 'scraping' && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
                  {item.status === 'classifying' && <Loader2 className="w-4 h-4 text-purple-500 animate-spin" />}
                  {item.status === 'completed' && <CheckCircle className="w-4 h-4 text-green-500" />}
                  {item.status === 'error' && <XCircle className="w-4 h-4 text-red-500" />}
                </td>
                <td className="px-4 py-3 max-w-[300px] truncate text-slate-600" title={item.url}>
                  {item.url}
                </td>
                <td className="px-4 py-3">
                  {item.status === 'completed' && item.data ? (
                    <div className="flex flex-wrap gap-1">
                      {item.data.tags.types.slice(0, 2).map((t, i) => (
                        <span key={i} className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full text-[10px] font-medium border border-emerald-200">
                          {t.replace('type:', '')}
                        </span>
                      ))}
                      {item.data.tags.personas.slice(0, 1).map((t, i) => (
                        <span key={i} className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-[10px] font-medium border border-blue-200">
                          {t.replace('persona:', '')}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">
                       {item.status === 'error' ? 'Failed' : item.status === 'pending' ? '-' : 'Working...'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};