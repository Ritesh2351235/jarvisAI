import { motion } from "framer-motion";
import { ScrollArea } from "./ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { ListOrdered, Code } from "lucide-react";

interface EditorProps {
  assistantResponses: Array<{
    text: string;
    timestamp: string;
    details?: {
      steps?: string[];
      code?: string;
      type: 'steps' | 'code' | 'none';
    };
  }>;
}

export function StepsAndCodeEditor({ assistantResponses }: EditorProps) {
  // Get the latest response that has details
  const latestResponseWithDetails = [...assistantResponses]
    .reverse()
    .find(response => response.details && response.details.type !== 'none');

  if (!latestResponseWithDetails?.details) return null;

  const { details } = latestResponseWithDetails;

  return (
    <div className="h-[400px]">
      <Tabs defaultValue={details.type}>
        <TabsList className="w-full rounded-none border-b bg-transparent px-4">
          <TabsTrigger
            value="steps"
            className="data-[state=active]:border-b-2 data-[state=active]:border-blue-500 rounded-none"
          >
            <ListOrdered className="h-4 w-4 mr-2" />
            Steps
          </TabsTrigger>
          {details.code && (
            <TabsTrigger
              value="code"
              className="data-[state=active]:border-b-2 data-[state=active]:border-blue-500 rounded-none"
            >
              <Code className="h-4 w-4 mr-2" />
              Code
            </TabsTrigger>
          )}
        </TabsList>

        {/* Steps content */}
        {details.steps && (
          <TabsContent value="steps" className="p-4">
            <ScrollArea className="h-[340px]">
              <ol className="space-y-4">
                {details.steps.map((step, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/50">
                      <span className="text-sm font-medium text-blue-600 dark:text-blue-300">
                        {index + 1}
                      </span>
                    </div>
                    <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                      {step}
                    </p>
                  </li>
                ))}
              </ol>
            </ScrollArea>
          </TabsContent>
        )}

        {/* Code content */}
        {details.code && (
          <TabsContent value="code" className="h-[340px]">
            <ScrollArea className="h-full">
              <div className="p-4 bg-slate-900 h-full">
                <pre className="text-sm">
                  <code className="text-slate-50 font-mono">{details.code}</code>
                </pre>
              </div>
            </ScrollArea>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
} 