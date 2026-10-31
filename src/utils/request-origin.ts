/** Browser mutations must originate from this local app. Requests made by the
 * existing CLI checks have no browser Origin; ownership checks still apply. */
export function isSameOriginRequest(request:Pick<Request,'method'|'url'|'headers'>):boolean{
    if(['GET','HEAD','OPTIONS'].includes(request.method.toUpperCase()))return true;
    const origin=request.headers.get('origin');
    if(!origin)return request.headers.get('sec-fetch-site')!=='cross-site';
    try{
        const expected=new URL(request.url),host=request.headers.get('host');
        if(host)expected.host=host;
        const supplied=new URL(origin);
        return origin===supplied.origin&&supplied.origin===expected.origin;
    }catch{return false;}
}
