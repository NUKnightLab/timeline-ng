import { mount } from 'svelte';
import { SlidePlayer } from '@knight-lab/timeline-ng';
import '@knight-lab/timeline-ng/styles.css';
import type { TLTimeline } from '@knight-lab/timeline-ng-core';

// Build the timeline as plain data — no ATProto, no fetch required.
// You can construct this from a database, a CMS, a spreadsheet, anything.
const timeline: TLTimeline = {
  title: {
    text: {
      headline: 'The Space Race',
      text: '<p>From Sputnik to the Moon, the defining milestones of humanity\'s first steps into space.</p>',
    },
  },
  events: [
    {
      start_date: { year: 1957, month: 10, day: 4 },
      text: {
        headline: 'Sputnik 1',
        text: '<p>The Soviet Union launches the world\'s first artificial satellite, beginning the Space Age and sparking the Space Race with the United States.</p>',
      },
      media: {
        url: 'https://www.youtube.com/watch?v=oWR70ngPYbc',
        caption: 'Sputnik launch footage',
        credit: "Universal International News archive via International Astronautical Federation"
      },
    },
    {
      start_date: { year: 1961, month: 4, day: 12 },
      text: {
        headline: 'Yuri Gagarin Orbits Earth',
        text: '<p>Soviet cosmonaut Yuri Gagarin becomes the first human in space, completing one orbit of Earth aboard Vostok 1 in 108 minutes.</p>',
      },
      media: {
        url: "https://en.wikipedia.org/wiki/Yuri_Gagarin#/media/File:Yuri_Gagarin_with_awards_(cropped)_2.jpg",
        caption: "Ceremonial portrait of the Soviet cosmonaut Yuri Alekseevich Gagarin with awards.",
        credit: "<a href=\"https://creativecommons.org/licenses/by/4.0/\">CC-BY 4.0</a> Mil.ru"
      }
    },
    {
      start_date: { year: 1961, month: 5, day: 25 },
      text: {
        headline: 'Kennedy\'s Moon Challenge',
        text: '<p>President Kennedy announces before Congress the goal of "landing a man on the Moon and returning him safely to the Earth" before the end of the decade.</p>',
      },
      media: {
        url: 'https://www.youtube.com/watch?v=8ygoE2YiHCs',
        caption: 'Kennedy\'s address to Congress',
      },
    },
    {
      start_date: { year: 1965, month: 3, day: 18 },
      text: {
        headline: 'First Spacewalk',
        text: '<p>Soviet cosmonaut Alexei Leonov exits Voskhod 2 and spends twelve minutes outside the spacecraft, becoming the first human to walk in space.</p>',
      },
    },
    {
      start_date: { year: 1969, month: 7, day: 20 },
      text: {
        headline: 'Apollo 11 Lands on the Moon',
        text: '<p>Neil Armstrong and Buzz Aldrin land the lunar module Eagle in the Sea of Tranquility. Armstrong\'s first step makes him the first human to walk on the Moon.</p>',
      },
      media: {
        url: 'https://youtu.be/cwZb2mqId0A',
        caption: 'Apollo 11 Moon landing footage',
      },
      background: { color: '#1a1a2e' },
    },
    {
      start_date: { year: 1972, month: 12, day: 14 },
      text: {
        headline: 'Last Human on the Moon',
        text: '<p>Apollo 17 astronaut Gene Cernan takes humanity\'s last steps on the lunar surface. No human has returned to the Moon since.</p>',
      },
    },
  ],
};

const target = document.getElementById('app');
if (!target) throw new Error('No #app element found');

mount(SlidePlayer, { target, props: { timeline } });
