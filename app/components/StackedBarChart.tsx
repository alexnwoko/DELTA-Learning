import { useEffect, useState } from "react";
import {
	BarChart,
	Bar,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	Legend,
	ResponsiveContainer,
} from "recharts";
import { ViewContext } from "~/frontend/context";

export default function CustomStackedBarChart({
	ctx,
	data,
}: {
	ctx: ViewContext;
	data: any[];
}) {
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	if (!mounted) return null; // Prevents SSR hydration error

	return (
		<>
			<ResponsiveContainer width="100%" height={300}>
				<BarChart
					data={data}
					margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
				>
					<CartesianGrid strokeDasharray="3 3" />
					<XAxis dataKey="name" />
					<YAxis />
					<Tooltip />
					<Legend />
					<Bar
						dataKey="damage"
						stackId="a"
						fill="#8884d8"
						name={ctx.t({ code: "common.damages", msg: "Damages" })}
					/>
					<Bar
						dataKey="losses"
						stackId="a"
						fill="#22aa9d"
						// Rounded at the top of the stack (Alex, 2026-10-17).
						radius={[6, 6, 0, 0]}
						name={ctx.t({ code: "common.losses", msg: "Losses" })}
					/>
				</BarChart>
			</ResponsiveContainer>
		</>
	);
}
