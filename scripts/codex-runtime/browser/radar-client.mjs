import {createClient as readClient} from './client.mjs';
export function createClient(){return {...readClient(),channel(){const channel={on(){return channel;},subscribe(){return channel;}};return channel;},removeChannel(){}};}
