import React, { useMemo } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { ClassifiedPage, StatData } from '../types';

interface DashboardProps {
  results: ClassifiedPage[];
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

export const Dashboard: React.FC<DashboardProps> = ({ results }) => {
  const stats = useMemo(() => {
    const personas: Record<string, number> = {};
    const stages: Record<string, number> = {};
    const types: Record<string, number> = {};
    const topics: Record<string, number> = {};

    results.forEach(item => {
      item.tags.personas.forEach(t => { const k = t.split(':')[1] || t; personas[k] = (personas[k] || 0) + 1; });
      item.tags.stages.forEach(t => { const k = t.split(':')[1] || t; stages[k] = (stages[k] || 0) + 1; });
      item.tags.types.forEach(t => { const k = t.split(':')[1] || t; types[k] = (types[k] || 0) + 1; });
      item.tags.topics.forEach(t => { const k = t.split(':')[1] || t; topics[k] = (topics[k] || 0) + 1; });
    });

    const format = (rec: Record<string, number>): StatData[] => 
      Object.entries(rec).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

    return {
      personas: format(personas),
      stages: format(stages),
      types: format(types),
      topics: format(topics),
    };
  }, [results]);

  if (results.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
      {/* Stages Distribution */}
      <div className="bg-white p-4 rounded-lg shadow border border-slate-200">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Content by Stage</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.stages} layout="vertical" margin={{ left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis dataKey="name" type="category" width={100} tick={{fontSize: 12}} />
              <Tooltip />
              <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Personas Distribution */}
      <div className="bg-white p-4 rounded-lg shadow border border-slate-200">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Target Personas</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={stats.personas}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {stats.personas.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

       {/* Types Distribution */}
       <div className="bg-white p-4 rounded-lg shadow border border-slate-200">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Medical Types</h3>
        <div className="h-64">
           <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.types}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{fontSize: 10}} interval={0} angle={-30} textAnchor="end" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

       {/* Topics Distribution */}
       <div className="bg-white p-4 rounded-lg shadow border border-slate-200">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Topics Coverage</h3>
        <div className="h-64">
           <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.topics} layout="vertical" margin={{left: 20}}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis dataKey="name" type="category" width={80} tick={{fontSize: 12}} />
              <Tooltip />
              <Bar dataKey="value" fill="#f59e0b" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};