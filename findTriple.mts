import { JSDOM } from 'jsdom';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { compress, decompress } from 'compress-json';
import { stringify } from 'csv-stringify/sync';

const TRIPLES_PATH = './triples.json';
const TRIPLES_CSV = './triples.csv';

const getPath = (year: string, state: string) => `./data/meets_${year}_${state}.json`;

const markToSecs = (mark: string): number => {
  if (mark.includes('(')) mark = mark.slice(0, mark.indexOf('(')).trim();
  mark = mark.replaceAll('h', '').replaceAll('+', '').replaceAll('*', '').trim();
  const [iPart, fPart] = mark.split('.');
  const groups = iPart.split(':');
  let res: number;
  if (groups.length === 1) res = +iPart;
  if (groups.length === 2) res = +groups[0] * 60 + +groups[1];
  if (groups.length === 3) res = +groups[0] * 60 * 60 + +groups[1] * 60 + +groups[2];
  return Number(String(res!) + (fPart ? '.' + fPart : ''));
};
const secsToMark = (secs: number): string => {
  secs = Math.round(secs * 100) / 100;
  const fPart = String(secs).includes('.') ? '.' + String(secs).split('.')[1].slice(0, 2).padEnd(2, '0') : '.00';
  if (secs < 60) return String(Math.floor(secs)) + fPart;
  const h = Math.floor(secs / (60 * 60));
  const m = Math.floor((secs - 60 * 60 * h) / 60);
  const s = secs - (60 * 60 * h + 60 * m);
  const stringSecs = String(Math.floor(s)).padStart(2, '0') + fPart;
  if (h) return String(h) + ':' + String(m).padStart(2, '0') + ':' + stringSecs;
  if (m) return String(m) + ':' + stringSecs;
  return stringSecs;
};

const EVENTS = ['400H', '800m', 'HJ'];

type Perf = {
  id: string;
  meetId: string;
  meetName: string;
  teamName: string;
  athleteId: string;
  firstName: string;
  lastName: string;
  gender: string;
  eventCode: string;
  mark: string;
};
type Meet = {
  meet: { id: string; date: string; meet: string; venue: string };
  results: Perf[];
};
type Meets = {
  [id: string]: Meet;
};
type Triples = { meet: Meet['meet']; athleteId: string; perfs: Perf[] }[];

const states = [
  'www',
  'ak',
  'al',
  'ar',
  'az',
  'ca',
  'co',
  'ct',
  'dc',
  'de',
  'fl',
  'ga',
  'hi',
  'ia',
  'id',
  'il',
  'in',
  'ks',
  'ky',
  'la',
  'ma',
  'md',
  'me',
  'mi',
  'mn',
  'mo',
  'ms',
  'mt',
  'nc',
  'nd',
  'ne',
  'nh',
  'nj',
  'nm',
  'nv',
  'ny',
  'oh',
  'ok',
  'or',
  'pa',
  'ri',
  'sc',
  'sd',
  'tn',
  'tx',
  'ut',
  'va',
  'vt',
  'wa',
  'wi',
  'wv',
  'wy',
];
const years = ['2022'];

// const oldMeets = JSON.parse(readFileSync('./meets.json', 'utf-8'));
// writeFileSync(getPath('2022', 'ny'), JSON.stringify(compress(oldMeets[2022].ny)));

const parseMeets = () => {
  const triples: Triples = [];
  for (const year of years) {
    for (const state of states) {
      const fname = getPath(year, state);
      if (!existsSync(fname)) continue;
      console.log(fname);
      const meets: Meets = decompress(JSON.parse(readFileSync(fname, 'utf-8')));
      for (const id in meets) {
        const { meet, results } = meets[id];
        const athletes = results.reduce((acc, perf) => {
          const { athleteId } = perf;
          acc[athleteId] ??= [];
          acc[athleteId].push(perf);
          return acc;
        }, {} as { [id: string]: Perf[] });
        for (const athId in athletes) {
          const perfs = athletes[athId];
          if ([...new Set(perfs.map((perf) => perf.eventCode))].sort().join(',') === EVENTS.join(',')) {
            const { firstName, lastName, meetName, meetId, athleteId, gender } = perfs[0];
            console.log(
              `${firstName} ${lastName} (${gender}) @ ${meet.date} ${year} ${meetName}: ${perfs
                .map((p) => p.mark)
                .join(', ')} https://${state}.milesplit.com/meets/${meetId}/results`
            );
            if (!triples.find((trip) => trip.meet.id === meetId && trip.athleteId === athleteId)) triples.push({ meet, athleteId, perfs });
          }
        }
      }
    }
  }
  writeFileSync(TRIPLES_PATH, JSON.stringify(triples));
};

const parseTriples = () => {
  const triples: Triples = JSON.parse(readFileSync(TRIPLES_PATH, 'utf-8'));
  const csvRows = triples.map(({ meet, perfs }) => {
    const { firstName, lastName, gender } = perfs[0];
    const row = {
      name: `${firstName} ${lastName}`,
      gender,
      meetName: meet.meet,
      date: meet.date,
      year: '2022',
      url: `https://www.milesplit.com/meets/${meet.id}/results`,
    };
    for (const evt of EVENTS) {
      const evtPerfs = perfs.filter((perf) => perf.eventCode === evt);
      row[evt] = evtPerfs.length > 1 ? secsToMark(Math.min(...evtPerfs.map((perf) => markToSecs(perf.mark)))) : evtPerfs[0].mark;
    }
    return row;
  });
  writeFileSync(TRIPLES_CSV, stringify(csvRows, { header: true }));
};

const fetchMeets = async () => {
  for (const year of years) {
    for (const state of states) {
      const fname = getPath(year, state);
      if (existsSync(fname)) continue;
      const calendarUrl = `https://${state}.milesplit.com/calendar?${new URLSearchParams({
        page: '1',
        season: 'outdoor',
        year,
        month: '*',
        level: '',
      })}`;
      console.log(calendarUrl);
      const { document } = new JSDOM(await (await fetch(calendarUrl)).text()).window;
      const meetsWithResults = [...document.querySelectorAll('td.results a')].map((a) => {
        const tr = a.parentElement?.parentElement;
        return {
          id: (a.getAttribute('href')?.match(/\/meets\/(\d+)/) ?? [])[1],
          date: tr?.querySelector('.date')?.textContent,
          meet: tr?.querySelector('.meetName')?.textContent?.trim(),
          venue: tr?.querySelector('.venue')?.textContent,
        };
      });
      const meets: Meets = {};
      for (const meet of meetsWithResults) {
        const { id } = meet;
        const resultsUrl = `https://${state}.milesplit.com/api/v1/meets/${id}/performances?${new URLSearchParams({
          fields:
            'id,meetId,meetName,teamId,videoId,teamName,athleteId,firstName,lastName,gender,genderName,divisionId,divisionName,ageGroupName,gradYear,eventName,eventCode,eventDistance,eventGenreOrder,round,roundName,heat,units,mark,place,windReading,profileUrl,teamProfileUrl,performanceVideoId',
          m: 'GET',
        })}`;
        console.log(resultsUrl);
        let data: any;
        try {
          ({ data } = await (await fetch(resultsUrl)).json());
        } catch (e) {
          console.log(e, resultsUrl);
          continue;
        }
        await new Promise((res) => setTimeout(res, 500));
        console.log(meet, data[0], data.length);
        meets[id] = { meet, results: data };
      }
      if (Object.keys(meets).length) writeFileSync(fname, JSON.stringify(compress(meets)));
    }
  }
};

parseTriples();
