import { TimeSeriesSession } from "@vizcrush/downsample/session";
import { installTimeSeriesWorkerHost } from "@vizcrush/downsample/worker-host";

const POINT_COUNT = 1_000_000;
const x = new Float64Array(POINT_COUNT);
const y = new Float64Array(POINT_COUNT);
let state = 7;
for (let index = 0; index < POINT_COUNT; index += 1) {
  state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
  x[index] = 1_700_000_000_000 + index * 100;
  y[index] =
    Math.sin(index / 7_000) * 16 + Math.sin(index / 311) * 2 + (state / 4_294_967_296 - 0.5);
}

const session = new TimeSeriesSession({
  capacity: POINT_COUNT,
  maxOutputPoints: 20_000,
  pointsPerPixel: 1,
});
session.load(x, y);
installTimeSeriesWorkerHost(self, session);
